import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, ContainerAppsAPIClient, Revision } from "@azure/arm-appcontainers";
import { DeploymentResourceUpdateError, type DeploymentConfigurationIdentity, type DeploymentResourceApplyInput, type DeploymentResourceApplyResult, type DeploymentResourceReconcileResult } from "@kumo/application";
import type { DeploymentResourceConfigurationDetails } from "@kumo/domain";
import { AzureDeploymentConfigurationReader, type DeploymentRevisionReader } from "../dist/azure/deployment-configuration.js";
import { AzureDeploymentConfigurationUpdater } from "../dist/azure/deployment-configuration-updater.js";

const IDENTITY: DeploymentConfigurationIdentity = { userId: "123", deploymentId: "deployment", appName: "my-app",
  resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app" };
const REQUESTED: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 0, maxScaling: 3 };
interface State { app: ContainerApp; writes: ContainerApp[]; events: string[]; pollError: Error | null; }
interface Fixture extends State {
  updater: AzureDeploymentConfigurationUpdater;
  input(onTargetRevision?: (revision: string) => Promise<void>): Promise<DeploymentResourceApplyInput>;
}

function fixture(stopped: boolean = false): Fixture {
  const state: State = { writes: [], events: [], pollError: null, app: {
    id: IDENTITY.resourceId, name: "my-app", location: "japaneast", provisioningState: "Succeeded", runningStatus: stopped ? "Stopped" : "Running",
    environmentId: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared-env",
    latestRevisionName: "my-app--initial", latestReadyRevisionName: "my-app--initial",
    tags: { "kumo-deployment-id": IDENTITY.deploymentId, "kumo-build-id": "old-build", custom: "keep" },
    identity: { type: "SystemAssigned" },
    configuration: { activeRevisionsMode: "Single", ingress: { external: false, targetPort: 8080 }, secrets: [{ name: "password", value: "masked" }] },
    template: {
      containers: [
        { name: "sidecar", image: "sidecar:fixed", resources: { cpu: 0.25, memory: "0.5Gi" } },
        { name: "my-app", image: "registry/app:old", resources: { cpu: 0.5, memory: "1Gi", ephemeralStorage: "2Gi" },
          env: [{ name: "PASSWORD", secretRef: "password" }], probes: [{ type: "Readiness", tcpSocket: { port: 8080 } }],
          volumeMounts: [{ volumeName: "data", mountPath: "/data" }] },
      ],
      initContainers: [{ name: "init", image: "init:fixed" }], volumes: [{ name: "data", storageType: "AzureFile", storageName: "existing" }],
      serviceBinds: [{ name: "redis", serviceId: "/services/redis" }],
      scale: { minReplicas: 0, maxReplicas: 2, pollingInterval: 17, cooldownPeriod: 123, rules: [{ name: "http", http: { metadata: { concurrentRequests: "37" } } }] },
    },
  } };
  const apps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "update" | "start" | "stop"> = {
    get: async (): Promise<ContainerApp> => structuredClone(state.app),
    update: (group: string, name: string, patch: ContainerApp): ReturnType<ContainerAppsAPIClient["containerApps"]["update"]> => {
      assert.equal(group, "user-rg-123"); assert.equal(name, "my-app");
      state.writes.push(structuredClone(patch)); state.events.push("update");
      const target: string = `${name}--${patch.template?.revisionSuffix}`;
      state.app = { ...state.app, template: patch.template, tags: { ...state.app.tags, ...patch.tags }, latestRevisionName: target,
        latestReadyRevisionName: state.pollError ? state.app.latestReadyRevisionName : target };
      return { pollUntilDone: async (): Promise<ContainerApp> => { if (state.pollError) throw state.pollError; return structuredClone(state.app); } } as ReturnType<ContainerAppsAPIClient["containerApps"]["update"]>;
    },
    start: (): never => { state.events.push("start"); throw new Error("Unexpected start"); },
    stop: (): never => { state.events.push("stop"); throw new Error("Unexpected stop"); },
  };
  const revisions: DeploymentRevisionReader = {
    getRevision: async (_group: string, _app: string, revision: string): Promise<Revision> => ({
      id: `${IDENTITY.resourceId}/revisions/${revision}`, name: revision, template: structuredClone(state.app.template), replicas: stopped ? 0 : 1,
      active: !stopped, trafficWeight: 100, healthState: "Healthy", provisioningState: revision === state.app.latestReadyRevisionName ? "Provisioned" : "Provisioning",
      runningState: stopped ? "Stopped" : "Running",
    }),
  };
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform",
    AZURE_SHARED_ENVIRONMENT_NAME: "shared-env", AZURE_DEPLOYMENT_TIMEOUT_MS: "100", AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "1" });
  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(config, apps, revisions);
  const updater: AzureDeploymentConfigurationUpdater = new AzureDeploymentConfigurationUpdater(config, apps, revisions, reader);
  return Object.assign(state, { updater, input: async (onTargetRevision: (revision: string) => Promise<void> = async (): Promise<void> => {}): Promise<DeploymentResourceApplyInput> => ({
    ...IDENTITY, operationId: "20000000-0000-4000-8000-000000000001", baseline: await updater.readBaseline(IDENTITY), requested: { ...REQUESTED },
    lifecycle: stopped ? "STOPPED" : "RUNNING", abortSignal: AbortSignal.timeout(500), onTargetRevision,
  }) });
}

test("resource update preserves the live image, sidecar, storage and scaling rules while omitting root configuration", async (): Promise<void> => {
  const setup: Fixture = fixture();
  const before: ContainerApp = structuredClone(setup.app);
  const input: DeploymentResourceApplyInput = await setup.input(async (): Promise<void> => { setup.events.push("checkpoint"); });
  const result: DeploymentResourceApplyResult = await setup.updater.update(input);
  assert.deepEqual(result.observed, REQUESTED); assert.equal(result.noOp, false);
  assert.deepEqual(setup.events, ["checkpoint", "update"]); assert.equal(setup.writes.length, 1);
  const patch: ContainerApp = setup.writes[0]!;
  assert.equal(patch.template?.containers?.[1]?.image, "registry/app:old");
  assert.equal(patch.template?.containers?.[1]?.resources?.cpu, 1); assert.equal(patch.template?.containers?.[1]?.resources?.memory, "2Gi");
  assert.equal(patch.template?.containers?.[1]?.resources?.ephemeralStorage, "2Gi");
  assert.deepEqual(patch.template?.containers?.[0], before.template?.containers?.[0]);
  assert.deepEqual(patch.template?.containers?.[1]?.env, before.template?.containers?.[1]?.env);
  assert.deepEqual(patch.template?.containers?.[1]?.probes, before.template?.containers?.[1]?.probes);
  assert.deepEqual(patch.template?.containers?.[1]?.volumeMounts, before.template?.containers?.[1]?.volumeMounts);
  assert.deepEqual(patch.template?.volumes, before.template?.volumes); assert.deepEqual(patch.template?.initContainers, before.template?.initContainers);
  assert.deepEqual(patch.template?.serviceBinds, before.template?.serviceBinds);
  assert.deepEqual(patch.template?.scale, { ...before.template?.scale, minReplicas: 0, maxReplicas: 3 });
  assert.equal(patch.tags?.["kumo-build-id"], "old-build"); assert.equal(patch.tags?.custom, "keep");
  assert.equal(patch.configuration, undefined); assert.equal(patch.identity, undefined);
  assert.equal(patch.environmentId, undefined); assert.equal(patch.managedEnvironmentId, undefined); assert.equal(patch.workloadProfileName, undefined);
});

test("foreign targets, Multiple mode and unsettled baselines are rejected before mutation", async (): Promise<void> => {
  const mutations: readonly ((setup: Fixture, input: DeploymentResourceApplyInput) => DeploymentResourceApplyInput)[] = [
    (_setup: Fixture, input: DeploymentResourceApplyInput): DeploymentResourceApplyInput => ({ ...input, resourceId: input.resourceId.replace("user-rg-123", "user-rg-456") }),
    (setup: Fixture, input: DeploymentResourceApplyInput): DeploymentResourceApplyInput => { setup.app = { ...setup.app, tags: { "kumo-deployment-id": "foreign" } }; return input; },
    (setup: Fixture, input: DeploymentResourceApplyInput): DeploymentResourceApplyInput => { setup.app = { ...setup.app, configuration: { activeRevisionsMode: "Multiple" } }; return input; },
    (setup: Fixture, input: DeploymentResourceApplyInput): DeploymentResourceApplyInput => { setup.app = { ...setup.app, latestRevisionName: "my-app--unready" }; return input; },
  ];
  for (let index: number = 0; index < mutations.length; index++) {
    const setup: Fixture = fixture();
    const input: DeploymentResourceApplyInput = mutations[index]!(setup, await setup.input());
    await assert.rejects(setup.updater.update(input), (error: unknown): boolean => error instanceof Error && !(error instanceof TypeError));
    assert.equal(setup.writes.length, 0); assert.deepEqual(setup.events, []);
  }
});

test("a failed durable checkpoint prevents any Azure update", async (): Promise<void> => {
  const setup: Fixture = fixture();
  let checkpointCalled: boolean = false;
  const input: DeploymentResourceApplyInput = await setup.input(async (): Promise<void> => {
    checkpointCalled = true; throw new Error("Checkpoint persistence failed");
  });
  await assert.rejects(setup.updater.update(input), /checkpoint|persist/i);
  assert.equal(checkpointCalled, true); assert.equal(setup.writes.length, 0); assert.deepEqual(setup.events, []);
});

test("unsupported STOPPED updates fail without a start/stop workaround", async (): Promise<void> => {
  const setup: Fixture = fixture(true);
  assert.equal(setup.updater.supportsStopped, false);
  await assert.rejects(async (): Promise<DeploymentResourceApplyResult> => setup.updater.update(await setup.input()),
    (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && !error.outcomeUnknown);
  assert.equal(setup.writes.length, 0); assert.deepEqual(setup.events, []); assert.equal(setup.app.runningStatus, "Stopped");
});

test("a lost PATCH result remains uncertain and reconciliation never resubmits the write", async (): Promise<void> => {
  const setup: Fixture = fixture();
  let targetRevision: string | null = null;
  const input: DeploymentResourceApplyInput = await setup.input(async (revision: string): Promise<void> => { targetRevision = revision; });
  setup.pollError = new Error("PATCH response lost");
  await assert.rejects(setup.updater.update(input), (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && error.outcomeUnknown);
  assert.ok(targetRevision); assert.equal(setup.writes.length, 1);
  const uncertain: DeploymentResourceReconcileResult = await setup.updater.reconcile({ ...input, targetRevision });
  assert.equal(uncertain.outcome, "unknown"); assert.equal(setup.writes.length, 1);
  setup.app = { ...setup.app, latestReadyRevisionName: targetRevision };
  const confirmed: DeploymentResourceReconcileResult = await setup.updater.reconcile({ ...input, targetRevision });
  assert.equal(confirmed.outcome, "succeeded"); assert.equal(setup.writes.length, 1);
});
