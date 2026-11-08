import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, Revision } from "@azure/arm-appcontainers";
import { DeploymentResourceUpdateError, type DeploymentResourceApplyInput, type DeploymentResourceReconcileInput, type DeploymentResourceReconcileResult } from "@kumo/application";
import type { DeploymentResourceBaseline, DeploymentResourceConfigurationDetails } from "@kumo/domain";
import { createResourceBaseline } from "../dist/azure/deployment-resource-baseline.js";
import { AzureDeploymentConfigurationReader } from "../dist/azure/deployment-configuration.js";
import { AzureDeploymentConfigurationUpdater, resourceUpdateRevisionSuffix } from "../dist/azure/deployment-configuration-updater.js";

const OPERATION: string = "abcdef01-1234-4567-89ab-abcdef012345";
const RESOURCE: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/app";
const ENVIRONMENT: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared";
const REQUEST: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 1, maxScaling: 1 };
const TARGET: string = `app--${resourceUpdateRevisionSuffix(OPERATION)}`;
interface Fixture {
  app: ContainerApp; revision: Revision; baseline: DeploymentResourceBaseline; writes: ContainerApp[]; pollError: boolean;
  readError: boolean; updater: AzureDeploymentConfigurationUpdater; input: DeploymentResourceReconcileInput;
}
function fixture(): Fixture {
  const state: Omit<Fixture, "updater" | "input" | "baseline"> = {
    app: {
      id: RESOURCE, name: "app", location: "East Asia", provisioningState: "Succeeded", runningStatus: "Running", environmentId: ENVIRONMENT,
      latestRevisionName: TARGET, latestReadyRevisionName: TARGET,
      tags: { "kumo-deployment-id": "deployment", "kumo-resource-update-id": OPERATION, custom: "preserve" },
      configuration: { activeRevisionsMode: "Single", ingress: { external: true, targetPort: 8080, traffic: [{ latestRevision: true, weight: 100 }] }, secrets: [{ name: "secret", value: "never-send" }] },
      template: { containers: [{ name: "app", image: "registry/app:commit", resources: { cpu: 1, memory: "2Gi" }, env: [{ name: "TOKEN", secretRef: "secret" }] }], scale: { minReplicas: 1, maxReplicas: 1 } },
    },
    revision: { id: `${RESOURCE}/revisions/${TARGET}`, name: TARGET, active: true, healthState: "Healthy", provisioningState: "Provisioned", runningState: "RunningAtMaxScale", replicas: 1 },
    writes: [], pollError: false, readError: false,
  };
  state.revision = { ...state.revision, template: structuredClone(state.app.template) };
  const identity: { resourceId: string; deploymentId: string; userId: string; appName: string } = { resourceId: RESOURCE, deploymentId: "deployment", userId: "123", appName: "app" };
  const baseline: DeploymentResourceBaseline = { ...createResourceBaseline(state.app, state.revision, identity, ENVIRONMENT), revisionName: "app--old", configuration: { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 } };
  const apps: ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[1] = {
    get: async (): Promise<ContainerApp> => { if (state.readError) throw new Error("temporary Azure outage"); return structuredClone(state.app); },
    update: (_group: string, _name: string, envelope: ContainerApp): ReturnType<ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[1]["update"]> => {
      state.writes.push(structuredClone(envelope));
      state.app = { ...state.app, template: envelope.template, tags: envelope.tags, latestRevisionName: TARGET, latestReadyRevisionName: TARGET };
      state.revision = { ...state.revision, id: `${RESOURCE}/revisions/${TARGET}`, name: TARGET, template: envelope.template };
      return { pollUntilDone: async (): Promise<ContainerApp> => { if (state.pollError) throw new Error("lost response"); return state.app; } } as ReturnType<ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[1]["update"]>;
    },
  };
  const revisions: ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[2] = { getRevision: async (): Promise<Revision> => structuredClone(state.revision) };
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform", AZURE_SHARED_ENVIRONMENT_NAME: "shared", AZURE_DEPLOYMENT_TIMEOUT_MS: "1000", AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "1" });
  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(config, apps, revisions);
  return Object.assign(state, { baseline, updater: new AzureDeploymentConfigurationUpdater(config, apps, revisions, reader),
    input: { ...identity, operationId: OPERATION, baseline, requested: REQUEST, lifecycle: "RUNNING" as const, targetRevision: TARGET, abortSignal: new AbortController().signal } });
}

test("verification accepts the exact healthy at-max target without another Azure write", async (): Promise<void> => {
  const setup: Fixture = fixture(); const result: DeploymentResourceReconcileResult = await setup.updater.reconcile(setup.input);
  assert.equal(result.outcome, "succeeded"); assert.deepEqual(result.observed, REQUEST); assert.equal(setup.writes.length, 0);
});

const unverified: Array<{ name: string; change: (setup: Fixture) => void }> = [
  { name: "operation tag belongs to another command", change: (s): void => { s.app = { ...s.app, tags: { ...s.app.tags, "kumo-resource-update-id": "foreign" } }; } },
  { name: "deployment ownership tag changed", change: (s): void => { s.app = { ...s.app, tags: { ...s.app.tags, "kumo-deployment-id": "foreign" } }; } },
  { name: "environment changed", change: (s): void => { s.app = { ...s.app, environmentId: "/foreign/environment" }; } },
  { name: "revision belongs to another app", change: (s): void => { s.revision = { ...s.revision, id: `/foreign/revisions/${TARGET}` }; } },
  { name: "latest revision changed", change: (s): void => { s.app = { ...s.app, latestRevisionName: "app--other" }; } },
  { name: "latest ready revision is still old", change: (s): void => { s.app = { ...s.app, latestReadyRevisionName: "app--old" }; } },
  { name: "app provisioning is incomplete", change: (s): void => { s.app = { ...s.app, provisioningState: "Updating" }; } },
  { name: "target provisioning is incomplete", change: (s): void => { s.revision = { ...s.revision, provisioningState: "Provisioning" }; } },
  { name: "target is unhealthy", change: (s): void => { s.revision = { ...s.revision, healthState: "Unhealthy" }; } },
  { name: "target is not active", change: (s): void => { s.revision = { ...s.revision, active: false }; } },
  { name: "app stopped during update", change: (s): void => { s.app = { ...s.app, runningStatus: "Stopped" }; } },
  { name: "image changed on the app", change: (s): void => { s.app = { ...s.app, template: { ...s.app.template, containers: [{ name: "app", image: "other:commit", resources: { cpu: 1, memory: "2Gi" } }] } }; } },
  { name: "target revision still has old resources", change: (s): void => { s.revision = { ...s.revision, template: { ...s.revision.template, containers: [{ name: "app", image: "registry/app:commit", resources: { cpu: 0.5, memory: "1Gi" } }] } }; } },
  { name: "revision scaling differs", change: (s): void => { s.revision = { ...s.revision, template: { ...s.revision.template, scale: { minReplicas: 0, maxReplicas: 2 } } }; } },
  { name: "multiple revisions are enabled", change: (s): void => { s.app = { ...s.app, configuration: { ...s.app.configuration, activeRevisionsMode: "Multiple" } }; } },
  { name: "traffic is pinned", change: (s): void => { s.app = { ...s.app, configuration: { ...s.app.configuration, ingress: { ...s.app.configuration?.ingress, traffic: [{ revisionName: TARGET, weight: 100 }] } } }; } },
  { name: "Azure reads fail temporarily", change: (s): void => { s.readError = true; } },
];
for (let index: number = 0; index < unverified.length; index++) {
  const scenario: { name: string; change: (setup: Fixture) => void } = unverified[index]!;
  test(`verification remains unknown when ${scenario.name}`, async (): Promise<void> => {
    const setup: Fixture = fixture(); scenario.change(setup);
    assert.equal((await setup.updater.reconcile(setup.input)).outcome, "unknown");
    assert.equal(setup.writes.length, 0);
  });
}

test("a definitively failed target is reported as failed, never as successful rollback", async (): Promise<void> => {
  const setup: Fixture = fixture(); setup.revision = { ...setup.revision, runningState: "Failed", provisioningState: "Provisioned" };
  const result: DeploymentResourceReconcileResult = await setup.updater.reconcile(setup.input);
  assert.equal(result.outcome, "failed"); if (result.outcome === "failed") assert.equal(result.errorCode, "RESOURCE_REVISION_FAILED");
  assert.deepEqual(result.observed, REQUEST); assert.equal(setup.writes.length, 0);
});

test("scale-to-zero succeeds only when zero minimum replicas and zero observed replicas agree", async (): Promise<void> => {
  const setup: Fixture = fixture();
  setup.app = { ...setup.app, template: { ...setup.app.template, scale: { minReplicas: 0, maxReplicas: 1 } } };
  setup.revision = { ...setup.revision, template: setup.app.template, replicas: 0, runningState: "ScaledToZero" };
  const input: DeploymentResourceReconcileInput = { ...setup.input, requested: { ...REQUEST, minScaling: 0 } };
  assert.equal((await setup.updater.reconcile(input)).outcome, "succeeded");
  assert.equal((await setup.updater.reconcile(setup.input)).outcome, "unknown");
});

test("a no-op verifies the current baseline and submits no PATCH", async (): Promise<void> => {
  const setup: Fixture = fixture(); const baseline: DeploymentResourceBaseline = await setup.updater.readBaseline(setup.input);
  const checkpoints: string[] = [];
  const input: DeploymentResourceApplyInput = { ...setup.input, baseline, onTargetRevision: async (revision: string): Promise<void> => { checkpoints.push(revision); } };
  const result: Awaited<ReturnType<AzureDeploymentConfigurationUpdater["update"]>> = await setup.updater.update(input);
  assert.equal(result.noOp, true); assert.deepEqual(result.observed, REQUEST); assert.deepEqual(checkpoints, [TARGET]); assert.equal(setup.writes.length, 0);
});

test("a changed baseline between checkpoint and PATCH prevents the write", async (): Promise<void> => {
  const setup: Fixture = fixture(); const baseline: DeploymentResourceBaseline = await setup.updater.readBaseline(setup.input);
  await assert.rejects(setup.updater.update({ ...setup.input, baseline, requested: { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 },
    onTargetRevision: async (): Promise<void> => { setup.app = { ...setup.app, latestRevisionName: "app--external", latestReadyRevisionName: "app--external" }; setup.revision = { ...setup.revision, id: `${RESOURCE}/revisions/app--external`, name: "app--external" }; },
  }), (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && error.code === "RESOURCE_BASELINE_CHANGED");
  assert.equal(setup.writes.length, 0);
});

test("PATCH is issued once, preserves secret references and excludes root secrets, identities and ingress", async (): Promise<void> => {
  const setup: Fixture = fixture(); const baseline: DeploymentResourceBaseline = await setup.updater.readBaseline(setup.input);
  const requested: DeploymentResourceConfigurationDetails = { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 };
  const result: Awaited<ReturnType<AzureDeploymentConfigurationUpdater["update"]>> = await setup.updater.update({ ...setup.input, baseline, requested, onTargetRevision: async (): Promise<void> => {} });
  assert.deepEqual(result.observed, requested); assert.equal(setup.writes.length, 1);
  assert.deepEqual(setup.writes[0]?.template?.containers?.[0]?.env, [{ name: "TOKEN", secretRef: "secret" }]);
  assert.equal(setup.writes[0]?.configuration, undefined); assert.equal(setup.writes[0]?.identity, undefined);
  assert.equal(setup.writes[0]?.tags?.custom, "preserve");
});

test("a lost PATCH result stays uncertain and later verification does not resubmit", async (): Promise<void> => {
  const setup: Fixture = fixture(); const baseline: DeploymentResourceBaseline = await setup.updater.readBaseline(setup.input);
  setup.pollError = true;
  const requested: DeploymentResourceConfigurationDetails = { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 };
  await assert.rejects(setup.updater.update({ ...setup.input, baseline, requested, onTargetRevision: async (): Promise<void> => {} }),
    (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && error.outcomeUnknown);
  assert.equal((await setup.updater.reconcile({ ...setup.input, baseline, requested })).outcome, "succeeded");
  assert.equal(setup.writes.length, 1);
});
