import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp } from "@azure/arm-appcontainers";
import type { DeploymentResourceDeleter } from "@kumo/application";
import { AzureDeploymentDeleter } from "../dist/azure/deployment-deleter.js";

const RESOURCE_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app";
const SHARED_ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared-env";
const LEGACY_ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/managedEnvironments/user-aca-env-123";
const VOLUME: { readonly name: string; readonly mountPath: string; readonly sizeGb: number } = {
  name: "data",
  mountPath: "/data",
  sizeGb: 32,
};

interface FixtureOptions {
  readonly app?: ContainerApp;
  readonly appLookupError?: unknown;
  readonly appDeleteError?: unknown;
  readonly storageLinkLookupError?: unknown;
  readonly storageLinkDeleteError?: unknown;
  readonly storageLinkAccountName?: string;
  readonly storageLinkShareName?: string;
}

interface Fixture {
  readonly deleter: DeploymentResourceDeleter;
  readonly events: string[];
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const events: string[] = [];
  const app: ContainerApp = options.app ?? {
    id: RESOURCE_ID,
    name: "my-app",
    location: "southeastasia",
    environmentId: SHARED_ENVIRONMENT_ID,
    tags: { "kumo-deployment-id": "deployment-1" },
  };
  const clients: unknown = {
    containerApps: {
      get: async (resourceGroup: string, appName: string): Promise<ContainerApp> => {
        events.push(`app-get:${resourceGroup}/${appName}`);
        if (options.appLookupError) throw options.appLookupError;
        return app;
      },
      delete: (resourceGroup: string, appName: string): unknown => {
        events.push(`app-delete:${resourceGroup}/${appName}`);
        return {
          pollUntilDone: async (): Promise<void> => {
            events.push("app-delete-complete");
            if (options.appDeleteError) throw options.appDeleteError;
          },
        };
      },
    },
    managedEnvironmentsStorages: {
      get: async (resourceGroup: string, environmentName: string, storageName: string): Promise<unknown> => {
        events.push(`storage-link-get:${resourceGroup}/${environmentName}/${storageName}`);
        if (options.storageLinkLookupError) throw options.storageLinkLookupError;
        return {
          properties: {
            azureFile: {
              accountName: options.storageLinkAccountName ?? "stkumo123",
              shareName: options.storageLinkShareName ?? "share-vol-data",
            },
          },
        };
      },
      delete: async (resourceGroup: string, environmentName: string, storageName: string): Promise<void> => {
        events.push(`storage-link-delete:${resourceGroup}/${environmentName}/${storageName}`);
        if (options.storageLinkDeleteError) throw options.storageLinkDeleteError;
        events.push("storage-link-delete-complete");
      },
    },
  };
  const config: ConfigService = new ConfigService({
    AZURE_SUBSCRIPTION_ID: "sub",
    AZURE_PLATFORM_RESOURCE_GROUP: "platform",
    AZURE_SHARED_ENVIRONMENT_NAME: "shared-env",
  });
  const clientArgument: ConstructorParameters<typeof AzureDeploymentDeleter>[1] =
    clients as ConstructorParameters<typeof AzureDeploymentDeleter>[1];
  const deleter: DeploymentResourceDeleter = new AzureDeploymentDeleter(config, clientArgument);
  return { deleter, events };
}

test("AzureDeploymentDeleter resolves the existing app environment only after verifying app identity", async (): Promise<void> => {
  const setup: Fixture = createFixture();
  const environmentId: string | null = await setup.deleter.resolveContainerAppEnvironmentId({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
  });
  assert.equal(environmentId, SHARED_ENVIRONMENT_ID);
  assert.deepEqual(setup.events, ["app-get:user-rg-123/my-app"]);
});

test("AzureDeploymentDeleter permits the app's canonical legacy environment in its owner resource group", async (): Promise<void> => {
  const setup: Fixture = createFixture({
    app: {
      id: RESOURCE_ID,
      name: "my-app",
      location: "southeastasia",
      environmentId: LEGACY_ENVIRONMENT_ID,
      tags: { "kumo-deployment-id": "deployment-1" },
    },
  });
  const environmentId: string | null = await setup.deleter.resolveContainerAppEnvironmentId({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
  });
  assert.equal(environmentId, LEGACY_ENVIRONMENT_ID);
  await setup.deleter.deleteDeploymentStorageLinks({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    environmentId,
    volumes: [VOLUME],
  });
  assert.ok(setup.events.includes("storage-link-delete:user-rg-123/user-aca-env-123/stg-my-app-data"));
});

test("AzureDeploymentDeleter polls Container App deletion and then accepts Azure 404 as already absent", async (): Promise<void> => {
  const setup: Fixture = createFixture();
  await setup.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  });
  assert.ok(setup.events.includes("app-delete:user-rg-123/my-app"));
  assert.ok(setup.events.includes("app-delete-complete"));

  const alreadyAbsent: Fixture = createFixture({ appDeleteError: { statusCode: 404 } });
  await assert.doesNotReject(alreadyAbsent.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  }));
  assert.ok(alreadyAbsent.events.includes("app-delete-complete"));
});

test("AzureDeploymentDeleter rejects foreign IDs and mismatched ownership tags before deletion", async (): Promise<void> => {
  const foreignId: Fixture = createFixture();
  await assert.rejects(foreignId.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "456",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  }));
  assert.deepEqual(foreignId.events, []);

  const wrongTag: Fixture = createFixture({
    app: {
      id: RESOURCE_ID,
      name: "my-app",
      location: "southeastasia",
      environmentId: SHARED_ENVIRONMENT_ID,
      tags: { "kumo-deployment-id": "another-deployment" },
    },
  });
  await assert.rejects(wrongTag.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  }));
  assert.equal(wrongTag.events.some((event: string): boolean => event.startsWith("app-delete:")), false);
});

test("AzureDeploymentDeleter treats a 404 from a structurally verified app lookup as already absent", async (): Promise<void> => {
  const missingApp: Fixture = createFixture({ appLookupError: { statusCode: 404 } });
  await assert.doesNotReject(missingApp.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  }));
  assert.equal(missingApp.events.some((event: string): boolean => event.startsWith("app-delete:")), false);
});

test("AzureDeploymentDeleter does not treat authorization or transient poller failures as success", async (): Promise<void> => {
  const setup: Fixture = createFixture({ appDeleteError: { statusCode: 403, message: "secret Azure detail" } });
  await assert.rejects(setup.deleter.deleteContainerApp({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    resourceId: RESOURCE_ID,
    environmentId: SHARED_ENVIRONMENT_ID,
  }), (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Container App deletion failed/);
    assert.doesNotMatch(error.message, /secret Azure detail/);
    return true;
  });
});

test("AzureDeploymentDeleter removes only the app-specific environment storage link and retains its share", async (): Promise<void> => {
  const setup: Fixture = createFixture();
  await setup.deleter.deleteDeploymentStorageLinks({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    environmentId: SHARED_ENVIRONMENT_ID,
    volumes: [VOLUME],
  });
  assert.ok(setup.events.includes("storage-link-delete:platform/shared-env/stg-my-app-data"));
  assert.ok(setup.events.includes("storage-link-delete-complete"));
  assert.equal(setup.events.some((event: string): boolean => /share-delete|resource-group-delete|environment-delete/.test(event)), false);
});

test("AzureDeploymentDeleter treats a missing storage link as complete without deleting a shared volume", async (): Promise<void> => {
  const setup: Fixture = createFixture({ storageLinkDeleteError: { statusCode: 404 } });
  await assert.doesNotReject(setup.deleter.deleteDeploymentStorageLinks({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    environmentId: SHARED_ENVIRONMENT_ID,
    volumes: [VOLUME],
  }));
  assert.ok(setup.events.includes("storage-link-delete:platform/shared-env/stg-my-app-data"));
  assert.equal(setup.events.some((event: string): boolean => event.includes("share-delete")), false);
});

test("AzureDeploymentDeleter returns idempotently when the app-specific storage link lookup returns 404", async (): Promise<void> => {
  const setup: Fixture = createFixture({ storageLinkLookupError: { statusCode: 404 } });
  await assert.doesNotReject(setup.deleter.deleteDeploymentStorageLinks({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    environmentId: SHARED_ENVIRONMENT_ID,
    volumes: [VOLUME],
  }));
  assert.equal(setup.events.some((event: string): boolean => event.startsWith("storage-link-delete:")), false);
});

test("AzureDeploymentDeleter refuses to remove a storage link that points outside the user's volume", async (): Promise<void> => {
  const setup: Fixture = createFixture({ storageLinkAccountName: "another-users-account" });
  await assert.rejects(setup.deleter.deleteDeploymentStorageLinks({
    deploymentId: "deployment-1",
    userId: "123",
    appName: "my-app",
    environmentId: SHARED_ENVIRONMENT_ID,
    volumes: [VOLUME],
  }));
  assert.equal(setup.events.some((event: string): boolean => event.startsWith("storage-link-delete:")), false);
});
