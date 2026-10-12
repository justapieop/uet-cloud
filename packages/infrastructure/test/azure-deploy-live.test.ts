import assert from "node:assert/strict";
import { test } from "node:test";
import { AzureDeployService } from "../dist/azure/azure-deploy.service.js";

const isLiveTestEnabled: boolean =
  process.env.RUN_AZURE_LIVE_TESTS?.trim().toLowerCase() === "true";

test(
  "Live Azure: provision user resource group and deploy container app",
  {
    skip: !isLiveTestEnabled
      ? "Skipped by default. Set RUN_AZURE_LIVE_TESTS=true to execute live Azure deployment."
      : false,
  },
  async (): Promise<void> => {
    const deployer: AzureDeployService = new AzureDeployService();

    const resourceGroupName: string =
      await deployer.ensureUserResourceGroup("dev-test-01");
    assert.equal(resourceGroupName, "user-rg-dev-test-01");

    const result: { fqdn: string } = await deployer.deployContainerApp({
      resourceGroupName,
      appName: "test-app-01",
      spec: {
        image: "mcr.microsoft.com/k8se/quickstart:latest",
        targetPort: 80,
        scaling: {
          minReplicas: 0,
          maxReplicas: 2,
        },
      },
    });

    assert.ok(result.fqdn);
    console.log(`\n🎉 Container App deployed successfully!`);
    console.log(`🔗 Resource Group: ${resourceGroupName}`);
    console.log(`🌐 Public URL: ${result.fqdn}\n`);
    assert.match(result.fqdn, /^https:\/\/test-app-01\./);
  },
);

test(
  "Live Azure: update existing container app specification and create new revision",
  {
    skip: !isLiveTestEnabled
      ? "Skipped by default. Set RUN_AZURE_LIVE_TESTS=true to execute live Azure deployment."
      : false,
  },
  async (): Promise<void> => {
    const deployer: AzureDeployService = new AzureDeployService();

    const resourceGroupName: string = "user-rg-dev-test-01";
    const appName: string = "test-app-01";

    // Update container app specification with new environment variables and scaling limits
    const updateResult: { fqdn: string } = await deployer.updateContainerApp({
      resourceGroupName,
      appName,
      spec: {
        envVars: {
          APP_ENV: "production",
          LIVE_UPDATE_VERIFIED: "true",
        },
        scaling: {
          minReplicas: 0,
          maxReplicas: 3,
        },
      },
    });

    assert.ok(updateResult.fqdn);
    console.log(`\n🎉 Container App updated successfully!`);
    console.log(`🔗 Resource Group: ${resourceGroupName}`);
    console.log(`🌐 Updated Public URL: ${updateResult.fqdn}\n`);
    assert.match(updateResult.fqdn, /^https:\/\/test-app-01\./);
  },
);

