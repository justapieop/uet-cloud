import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ContainerApp, ReplicaCollection, Revision } from "@azure/arm-appcontainers";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import type { DeploymentScalingIdentity, DeploymentScalingSnapshot, ScaleDecision } from "@kumo/application";
import { AzureDeploymentScaler, type DeploymentScalingClients } from "../dist/azure/deployment-scaler.js";
import { ScaleRuleWorker } from "../dist/azure/scale-rule-worker.js";

const IDENTITY: DeploymentScalingIdentity = { deploymentId: "deployment", userId: "123", appName: "my-app", resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app" };
const SIGNAL: AbortSignal = new AbortController().signal;
const CONFIG: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform", AZURE_DEPLOYMENT_TIMEOUT_MS: "30" });

class Fixture {
  public app: ContainerApp = { id: IDENTITY.resourceId, location: "japaneast", tags: { "kumo-deployment-id": "deployment" },
    provisioningState: "Succeeded", runningStatus: "Running", latestRevisionName: "my-app--old", latestReadyRevisionName: "my-app--old",
    identity: { type: "UserAssigned", userAssignedIdentities: { identity: {} } },
    configuration: { activeRevisionsMode: "Single", ingress: { fqdn: "my-app.example.com", external: true }, secrets: [{ name: "private", value: "never-patch" }] },
    template: { containers: [{ name: "my-app", image: "registry/app:sha", resources: { cpu: 0.5, memory: "1Gi" }, env: [{ name: "API_KEY", secretRef: "private" }], probes: [{ type: "Readiness", tcpSocket: { port: 8080 } }] }],
      scale: { minReplicas: 1, maxReplicas: 4 }, volumes: [{ name: "data", storageType: "AzureFile", storageName: "share" }] },
  };
  public count: number = 2;
  public writes: ContainerApp[] = [];
  public unhealthy: boolean = false;
  public pending: boolean = false;
  public readonly clients: DeploymentScalingClients = {
    containerApps: {
      get: async (): Promise<ContainerApp> => this.app,
      update: (_group, _name, patch): ReturnType<DeploymentScalingClients["containerApps"]["update"]> => {
        this.writes.push(patch);
        const revision: string = `my-app--${patch.template!.revisionSuffix}`;
        this.app = { ...this.app, template: patch.template, latestRevisionName: revision, latestReadyRevisionName: this.pending ? "my-app--old" : revision };
        this.count = patch.template!.scale!.minReplicas!;
        return { pollUntilDone: async (): Promise<ContainerApp> => this.app } as ReturnType<DeploymentScalingClients["containerApps"]["update"]>;
      },
    },
    revisions: { getRevision: async (): Promise<Revision> => ({ name: this.app.latestRevisionName, active: true, healthState: this.unhealthy ? "Unhealthy" : "Healthy", provisioningState: "Provisioned", trafficWeight: 100, replicas: this.count, createdTime: new Date("2026-11-01") }) },
    replicas: { listReplicas: async (): Promise<ReplicaCollection> => ({ value: Array.from({ length: this.count }, (_: unknown, index: number) => ({ name: `pod-${index}`, runningState: "Running", containers: [{ name: "my-app", ready: true, started: true }] })) }) },
  };
  public readonly scaler: AzureDeploymentScaler = new AzureDeploymentScaler(CONFIG, this.clients);
}

test("ACA scaling preserves the live template and waits for routing, readiness, and replica count", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  const snapshot: DeploymentScalingSnapshot = await fixture.scaler.inspect(IDENTITY, SIGNAL);
  const before: ContainerApp = fixture.app;
  await fixture.scaler.scale({ ...IDENTITY, expected: snapshot, targetReplicas: 3, operationId: "00000000-0000-4000-8000-000000000001" }, SIGNAL);
  assert.equal(fixture.writes.length, 1);
  const patch: ContainerApp = fixture.writes[0]!;
  assert.deepEqual(patch.template?.containers, before.template?.containers);
  assert.deepEqual(patch.template?.volumes, before.template?.volumes);
  assert.deepEqual(patch.template?.scale, { minReplicas: 3, maxReplicas: 3 });
  assert.equal(patch.configuration, undefined); assert.equal(patch.identity, undefined);
  assert.doesNotMatch(JSON.stringify(patch), /never-patch/);
  assert.equal((await fixture.scaler.inspect(IDENTITY, SIGNAL)).replicaNames.length, 3);
});

test("ACA scaling rejects foreign resources, unsupported revision modes, unhealthy apps, and competing native rules", async (): Promise<void> => {
  const invalid: readonly ((fixture: Fixture) => void)[] = [
    (fixture: Fixture): void => { fixture.app = { ...fixture.app, tags: { "kumo-deployment-id": "other" } }; },
    (fixture: Fixture): void => { fixture.app = { ...fixture.app, configuration: { ...fixture.app.configuration, activeRevisionsMode: "Multiple" } }; },
    (fixture: Fixture): void => { fixture.unhealthy = true; },
    (fixture: Fixture): void => { fixture.app = { ...fixture.app, template: { ...fixture.app.template, scale: { rules: [{ name: "native", http: { metadata: { concurrentRequests: "10" } } }] } } }; },
    (fixture: Fixture): void => { fixture.count = 0; },
    (fixture: Fixture): void => { fixture.app = { ...fixture.app, latestReadyRevisionName: "other-revision" }; },
  ];
  for (let index: number = 0; index < invalid.length; index++) {
    const fixture: Fixture = new Fixture(); invalid[index]!(fixture);
    await assert.rejects(fixture.scaler.inspect(IDENTITY, SIGNAL)); assert.equal(fixture.writes.length, 0);
  }
  const fixture: Fixture = new Fixture();
  await assert.rejects(fixture.scaler.inspect({ ...IDENTITY, resourceId: IDENTITY.resourceId.replace("user-rg-123", "platform") }, SIGNAL));
  await assert.rejects(fixture.scaler.inspect({ ...IDENTITY, userId: "456" }, SIGNAL));
});

test("ACA rechecks the observed replica set immediately before PATCH", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  const expected: DeploymentScalingSnapshot = await fixture.scaler.inspect(IDENTITY, SIGNAL);
  fixture.count = 3;
  await assert.rejects(fixture.scaler.scale({ ...IDENTITY, expected, targetReplicas: 3, operationId: "00000000-0000-4000-8000-000000000001" }, SIGNAL));
  assert.equal(fixture.writes.length, 0);
});

test("ACA never treats an accepted PATCH without a ready revision as successful", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  const expected: DeploymentScalingSnapshot = await fixture.scaler.inspect(IDENTITY, SIGNAL);
  fixture.pending = true;
  await assert.rejects(fixture.scaler.scale({ ...IDENTITY, expected, targetReplicas: 3, operationId: "00000000-0000-4000-8000-000000000001" }, SIGNAL));
  assert.equal(fixture.writes.length, 1, "Uncertain writes must not be retried");
});

async function flush(): Promise<void> { await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); }); }

test("scale worker bounds overlap, survives rule errors, and waits on shutdown", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  context.mock.method(Logger.prototype, "log", (): void => {});
  context.mock.method(Logger.prototype, "error", (): void => {});
  let evaluations: number = 0;
  let claims: number = 0;
  let release: () => void = (): void => {};
  const active: Promise<void> = new Promise<void>((resolve: () => void): void => { release = resolve; });
  const worker: ScaleRuleWorker = new ScaleRuleWorker({ claimNextDue: async (): Promise<string> => { claims++; return "deployment"; } },
    { failStaleScaling: async (before: Date): Promise<void> => { assert.equal(before.getTime(), 939_000); } },
    { exec: async (): Promise<ScaleDecision> => { evaluations++; if (evaluations === 1) throw new Error("bad rule"); await active; return { action: "NO_ACTION", targetReplicas: null, reason: "cooldown", metricValue: null }; } },
    new ConfigService({ AZURE_DEPLOYMENT_TIMEOUT_MS: "1000" }));
  worker.onApplicationBootstrap(); await flush();
  context.mock.timers.tick(1000); await flush(); assert.equal(evaluations, 2);
  context.mock.timers.tick(3000); await flush(); assert.equal(claims, 2);
  let stopped: boolean = false;
  const shutdown: Promise<void> = worker.onApplicationShutdown().then((): void => { stopped = true; });
  await flush(); assert.equal(stopped, false);
  release(); await shutdown;
  context.mock.timers.tick(3000); await flush(); assert.equal(claims, 2);
});
