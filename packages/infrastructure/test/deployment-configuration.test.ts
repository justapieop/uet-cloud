import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp } from "@azure/arm-appcontainers";
import { DeploymentConfigurationReadError, type DeploymentConfiguration } from "@kumo/application";
import { AzureDeploymentConfigurationReader } from "../dist/azure/deployment-configuration.js";

const INPUT: { resourceId: string; deploymentId: string; userId: string; appName: string } = {
  resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app",
  deploymentId: "deployment", userId: "123", appName: "my-app",
};
const CONFIG: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform" });
const APP: ContainerApp = {
  id: INPUT.resourceId, location: "Japan East", tags: { "kumo-deployment-id": INPUT.deploymentId },
  template: { containers: [{ name: "my-app", image: "registry/app:v2", resources: { cpu: 2, memory: "4096Mi" } }], scale: { minReplicas: 0, maxReplicas: 5 } },
  configuration: { ingress: { targetPort: 8080, external: false, fqdn: "live.example.com", additionalPortMappings: [{ targetPort: 9000, external: false }] } },
};

test("Azure reader maps applied configuration and GiB memory without requiring the creation request", async (): Promise<void> => {
  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(CONFIG, { get: async (group: string, app: string, options): Promise<ContainerApp> => {
    assert.equal(group, "user-rg-123"); assert.equal(app, "my-app"); assert.ok(options?.abortSignal); return APP;
  } });
  const result: DeploymentConfiguration = await reader.read(INPUT);
  assert.deepEqual(result, { region: "japaneast", maxVcpu: 2, maxMemory: 4, minScaling: 0, maxScaling: 5,
    targetPort: 8080, external: false, additionalPorts: [{ targetPort: 9000, exposedPort: 9000, external: false }], image: "registry/app:v2", fqdn: "live.example.com" });
  const absent: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(CONFIG, { get: async (): Promise<ContainerApp> => ({ ...APP,
    configuration: {}, template: { containers: [{ name: "my-app" }] },
  }) });
  assert.equal((await absent.read(INPUT)).maxMemory, null);
  assert.equal((await absent.read(INPUT)).image, null);
  assert.equal((await absent.read(INPUT)).fqdn, null);
  assert.equal((await absent.read(INPUT)).external, null);
});

test("Azure reader refuses foreign resource IDs before access and rejects replacement apps", async (): Promise<void> => {
  let calls: number = 0;
  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(CONFIG, { get: async (): Promise<ContainerApp> => {
    calls++; return { ...APP, tags: { "kumo-deployment-id": "other-deployment" } };
  } });
  for (const resourceId of [INPUT.resourceId.replace("user-rg-123", "user-rg-456"), INPUT.resourceId.replace("/sub/", "/other/"), INPUT.resourceId.replace("user-rg-123", "platform"), INPUT.resourceId + "/revisions/one"]) {
    await assert.rejects(reader.read({ ...INPUT, resourceId }), DeploymentConfigurationReadError);
  }
  assert.equal(calls, 0);
  await assert.rejects(reader.read(INPUT), DeploymentConfigurationReadError);
  assert.equal(calls, 1);
});

test("Azure failures and malformed responses fail without exposing upstream details", async (): Promise<void> => {
  for (const statusCode of [403, 404, 429, 500]) {
    const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(CONFIG, { get: async (): Promise<never> => { throw { statusCode, message: "secret upstream error" }; } });
    await assert.rejects(reader.read(INPUT), (error: unknown): boolean => error instanceof DeploymentConfigurationReadError &&
      error.reason === (statusCode === 404 ? "missing" : statusCode === 403 ? "invalid" : "unavailable") && !error.message.includes("secret"));
  }
  for (const app of [{ ...APP, id: "other" }, { ...APP, template: {} }, { ...APP, template: { containers: [{ name: "my-app", resources: { memory: "invalid" } }] } }]) {
    const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(CONFIG, { get: async (): Promise<ContainerApp> => app });
    await assert.rejects(reader.read(INPUT), DeploymentConfigurationReadError);
  }
});
