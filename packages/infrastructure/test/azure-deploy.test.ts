import assert from "node:assert/strict";
import { test } from "node:test";
import { AzureDeployService } from "../dist/azure/azure-deploy.service.js";

test("AzureDeployService rejects forbidden resource group int3319-test", async (): Promise<void> => {
  const service: AzureDeployService = new AzureDeployService();

  await assert.rejects(
    async (): Promise<void> => {
      await service.ensureUserResourceGroup("int3319-test");
    },
    /Forbidden: cannot operate on system resource group int3319-test/,
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
