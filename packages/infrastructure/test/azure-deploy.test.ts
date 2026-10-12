import assert from "node:assert/strict";
import { test } from "node:test";
import { UnsafeResourceGroupError } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import { AzureDeployService } from "../dist/azure/azure-deploy.service.js";

test("AzureDeployService rejects forbidden resource group int3319-test", async (): Promise<void> => {
  const service: AzureDeployService = new AzureDeployService();

  await assert.rejects(
    async (): Promise<void> => {
      await service.ensureUserResourceGroup("int3319-test");
    },
    /Forbidden: cannot operate on resource group user-rg-int3319-test/,
  );
});

test("AzureDeployService refuses to delete the configured platform resource group", async (): Promise<void> => {
  const values: Record<string, string> = {
    AZURE_PLATFORM_RESOURCE_GROUP: "user-rg-dev01",
  };
  const configService: ConfigService = {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  } as ConfigService;
  const service: AzureDeployService = new AzureDeployService(configService);

  await assert.rejects(
    service.deleteResourceGroup({
      userId: "dev01",
      resourceGroupName: "user-rg-dev01",
    }),
    UnsafeResourceGroupError,
  );
});

test("AzureDeployService refuses an RG that does not match the current user", async (): Promise<void> => {
  const service: AzureDeployService = new AzureDeployService();

  await assert.rejects(
    service.deleteContainerApp({
      userId: "dev01",
      resourceGroupName: "user-rg-dev02",
      appName: "sample-app",
    }),
    UnsafeResourceGroupError,
  );
});

test("AzureDeployService throws when AZURE_CONTAINER_APP_ENV_ID is not configured", async (): Promise<void> => {
  const prevEnvId: string | undefined = process.env.AZURE_CONTAINER_APP_ENV_ID;
  delete process.env.AZURE_CONTAINER_APP_ENV_ID;

  try {
    const service: AzureDeployService = new AzureDeployService();
    await assert.rejects(
      async (): Promise<void> => {
        await service.deployContainerApp({
          resourceGroupName: "user-rg-test",
          appName: "test-app",
          spec: {
            image: "nginx",
            targetPort: 80,
          },
        });
      },
      /AZURE_CONTAINER_APP_ENV_ID is not configured/,
    );
  } finally {
    if (prevEnvId) {
      process.env.AZURE_CONTAINER_APP_ENV_ID = prevEnvId;
    }
  }
});
