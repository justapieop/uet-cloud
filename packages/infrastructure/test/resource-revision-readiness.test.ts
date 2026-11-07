import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, Revision } from "@azure/arm-appcontainers";
import type { DeploymentResourceConfigurationDetails } from "@kumo/domain";
import type { DeploymentResourceReconcileResult } from "@kumo/application";
import { createResourceBaseline, readyRevision, type DeploymentResourceIdentity } from "../dist/azure/deployment-resource-baseline.js";
import { AzureDeploymentConfigurationReader } from "../dist/azure/deployment-configuration.js";
import { AzureDeploymentConfigurationUpdater, resourceUpdateRevisionSuffix } from "../dist/azure/deployment-configuration-updater.js";

const OPERATION: string = "abcdef01-1234-4567-89ab-abcdef012345";
const IDENTITY: DeploymentResourceIdentity = {
  resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/app",
  userId: "123", deploymentId: "deployment", appName: "app",
};
const CONFIGURATION: DeploymentResourceConfigurationDetails = { maxVcpu: 0.25, maxMemory: 0.5, minScaling: 1, maxScaling: 1 };
const REVISION_NAME: string = `app--${resourceUpdateRevisionSuffix(OPERATION)}`;
const ENVIRONMENT: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared";
const APP: ContainerApp = {
  id: IDENTITY.resourceId, location: "eastasia", provisioningState: "Succeeded", runningStatus: "Running",
  environmentId: ENVIRONMENT, latestRevisionName: REVISION_NAME, latestReadyRevisionName: REVISION_NAME,
  tags: { "kumo-deployment-id": IDENTITY.deploymentId, "kumo-resource-update-id": OPERATION },
  configuration: { activeRevisionsMode: "Single", ingress: { traffic: [{ latestRevision: true, weight: 100 }] } },
  template: { containers: [{ name: "app", image: "registry/app:commit", resources: { cpu: 0.25, memory: "0.5Gi" } }], scale: { minReplicas: 1, maxReplicas: 1 } },
};
const REVISION: Revision = {
  id: `${IDENTITY.resourceId}/revisions/${REVISION_NAME}`, name: REVISION_NAME,
  template: APP.template, active: true, replicas: 1, trafficWeight: 100,
  provisioningState: "Provisioned", healthState: "Healthy", runningState: "RunningAtMaxScale",
};

test("healthy revisions at maximum replicas are ready and provide a stable baseline", (): void => {
  assert.equal(readyRevision(APP, REVISION, REVISION_NAME, CONFIGURATION), true);
  assert.deepEqual(createResourceBaseline(APP, REVISION, IDENTITY, ENVIRONMENT).configuration, CONFIGURATION);
  assert.equal(readyRevision(APP, { ...REVISION, runningState: "Running" }, REVISION_NAME, CONFIGURATION), true);
});

test("at-max readiness still requires successful provisioning, health, activation and the latest ready revision", (): void => {
  const rejected: Revision[] = [
    { ...REVISION, provisioningState: "Provisioning" }, { ...REVISION, active: false },
    { ...REVISION, healthState: "Unhealthy" }, { ...REVISION, runningState: "Processing" },
    { ...REVISION, runningState: "Failed" }, { ...REVISION, runningState: "Stopped" },
    { ...REVISION, runningState: "ScaledToZero", replicas: 0 },
  ];
  for (let index: number = 0; index < rejected.length; index += 1) {
    assert.equal(readyRevision(APP, rejected[index]!, REVISION_NAME, CONFIGURATION), false);
  }
  assert.equal(readyRevision({ ...APP, provisioningState: "Updating" }, REVISION, REVISION_NAME, CONFIGURATION), false);
  assert.equal(readyRevision({ ...APP, latestReadyRevisionName: "app--old" }, REVISION, REVISION_NAME, CONFIGURATION), false);
  const idle: DeploymentResourceConfigurationDetails = { ...CONFIGURATION, minScaling: 0 };
  assert.equal(readyRevision(APP, { ...REVISION, runningState: "ScaledToZero", replicas: 0 }, REVISION_NAME, idle), true);
});

test("reconciliation completes an already applied resource update at maximum replicas without a second Azure write", async (): Promise<void> => {
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform", AZURE_SHARED_ENVIRONMENT_NAME: "shared" });
  const apps: ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[1] = {
    get: async (): Promise<ContainerApp> => APP,
    update: (): never => { throw new Error("Reconciliation must not submit another write"); },
  };
  const revisions: ConstructorParameters<typeof AzureDeploymentConfigurationUpdater>[2] = { getRevision: async (): Promise<Revision> => REVISION };
  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(config, apps, revisions);
  const updater: AzureDeploymentConfigurationUpdater = new AzureDeploymentConfigurationUpdater(config, apps, revisions, reader);
  const result: DeploymentResourceReconcileResult = await updater.reconcile({
    ...IDENTITY, operationId: OPERATION, targetRevision: REVISION_NAME, requested: CONFIGURATION, lifecycle: "RUNNING",
    baseline: { ...createResourceBaseline(APP, REVISION, IDENTITY, ENVIRONMENT), revisionName: "app--old" },
    abortSignal: new AbortController().signal,
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.observed, CONFIGURATION);
});
