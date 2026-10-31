import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContainerApp, ContainerAppsAPIClient, ManagedEnvironment } from "@azure/arm-appcontainers";
import { ConfigService } from "@nestjs/config";
import { AzureProvider, type AzureProviderClients } from "../dist/azure/provider.js";
import { AzureDeploymentConfigurationReader } from "../dist/azure/deployment-configuration.js";
import type { DeploymentVolume } from "@kumo/domain";

const ENVIRONMENT_ID: string =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/platform-rg/providers/Microsoft.App/managedEnvironments/shared-env";

function createSetup(options: { existingApp?: boolean; storageAccountExists?: boolean; useResourcesCreateOrUpdateById?: boolean } = {}): {
  provider: AzureProvider;
  events: string[];
  apps: Map<string, ContainerApp>;
  clients: AzureProviderClients;
} {
  const events: string[] = [];
  const apps: Map<string, ContainerApp> = new Map<string, ContainerApp>();

  if (options.existingApp) {
    apps.set("sample-app", {
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
      name: "sample-app",
      location: "japaneast",
      environmentId: ENVIRONMENT_ID,
      template: {
        containers: [
          {
            name: "sample-app",
            image: "registry.azurecr.io/sample-app:sha",
            resources: { cpu: 0.5, memory: "1Gi" },
            volumeMounts: [],
          },
        ],
        volumes: [],
      },
    });
  }

  const clients: AzureProviderClients = {
    resources: {
      getById: async () => ({
        properties: { loginServer: "registry.azurecr.io", anonymousPullEnabled: false },
      }),
      ...(options.useResourcesCreateOrUpdateById
        ? {
            createOrUpdateById: (async (resourceId: string, apiVersion: string, parameters: unknown): Promise<unknown> => {
              events.push(`resource-createById:${resourceId}:${apiVersion}:${JSON.stringify(parameters)}`);
              return parameters;
            }) as NonNullable<AzureProviderClients["resources"]["createOrUpdateById"]>,
          }
        : {}),
    },
    resourceGroups: {
      checkExistence: async () => ({ body: true }),
      get: async () => ({ location: "japaneast" }),
      createOrUpdate: async () => ({ location: "japaneast" }),
    },
    managedEnvironments: {
      get: async (): Promise<ManagedEnvironment> => ({
        id: ENVIRONMENT_ID,
        name: "shared-env",
        location: "japaneast",
        provisioningState: "Succeeded",
        workloadProfiles: [{ workloadProfileType: "Consumption", name: "Consumption" }],
      }),
    },
    containerApps: {
      get: async (_rg: string, name: string): Promise<ContainerApp> => {
        const app: ContainerApp | undefined = apps.get(name);
        if (!app) throw { statusCode: 404 };
        return app;
      },
      createOrUpdate: (_rg: string, name: string, envelope: ContainerApp) => {
        events.push("app-createOrUpdate");
        const app: ContainerApp = {
          ...envelope,
          id: `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/${name}`,
          provisioningState: "Succeeded",
        };
        apps.set(name, app);
        return { pollUntilDone: async (): Promise<ContainerApp> => app } as ReturnType<AzureProviderClients["containerApps"]["createOrUpdate"]>;
      },
      update: (_rg: string, name: string, envelope: ContainerApp) => {
        events.push("app-update");
        const existing: ContainerApp = apps.get(name)!;
        const app: ContainerApp = { ...existing, ...envelope };
        apps.set(name, app);
        return { pollUntilDone: async (): Promise<ContainerApp> => app } as ReturnType<AzureProviderClients["containerApps"]["update"]>;
      },
    },
    storageAccounts: {
      getProperties: async () => {
        events.push("storage-getProperties");
        if (options.storageAccountExists === false) {
          throw { statusCode: 404 };
        }
        return { location: "japaneast" };
      },
      create: (_rg: string, _name: string, parameters: unknown) => {
        events.push(`storage-create:${JSON.stringify(parameters)}`);
        return { pollUntilDone: async () => ({}) } as unknown as ReturnType<NonNullable<AzureProviderClients["storageAccounts"]>["create"]>;
      },
      listKeys: async () => {
        events.push("storage-listKeys");
        return { keys: [{ value: "fake-storage-key" }] };
      },
    },
    fileShares: {
      create: async (_rg, _acct, name, properties) => {
        events.push(`share-create:${name}:${properties.shareQuota}`);
        return { name };
      },
      get: async () => ({}),
      delete: async (_rg, _acct, name) => {
        events.push(`share-delete:${name}`);
      },
    },
    managedEnvironmentsStorages: {
      createOrUpdate: async (_rg, _env, name, parameters) => {
        const fileProps: any = (parameters as any)?.properties?.azureFile;
        events.push(`env-storage-create:${name}:identity=${fileProps?.identity}:hasKey=${Boolean(fileProps?.accountKey)}`);
        return parameters;
      },
      delete: async (_rg, _env, name) => {
        events.push(`env-storage-delete:${name}`);
      },
      get: async () => ({}),
    },
  };

  const config: ConfigService = new ConfigService({
    AZURE_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000000",
    AZURE_PLATFORM_RESOURCE_GROUP: "platform-rg",
    AZURE_RG_NAME: "platform-rg",
    AZURE_SHARED_ENVIRONMENT_NAME: "shared-env",
    AZURE_CONTAINER_REGISTRY_SERVER: "registry.azurecr.io",
    AZURE_CONTAINER_REGISTRY_NAME: "acr",
    AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME: "acr-pull-id",
    AZURE_DEPLOYMENT_TIMEOUT_MS: "30000",
    AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "100",
  });

  const triggerBuildMock = {
    exec: async () => ({
      buildId: "build-1",
      image: "registry.azurecr.io/sample-app:sha",
      runId: "run-1",
      status: "QUEUED" as const,
      commitSha: "sha",
      runUrl: null,
    }),
  };
  const getBuildMock = {
    exec: async (id: string, userId: string) => ({
      id,
      userId,
      repo: "https://github.com/owner/repo",
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ref: null,
      error: null,
      dockerFilePath: "Dockerfile",
      image: "registry.azurecr.io/sample-app:sha",
      status: "SUCCEEDED" as const,
      sourceTokenHash: "a".repeat(64),
      sourceExpiresAt: new Date(Date.now() + 60_000),
      runId: "run-1",
      runUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const provider: AzureProvider = new AzureProvider(
    config,
    triggerBuildMock,
    getBuildMock,
    clients,
    () => { throw new Error("Legacy factory should not be called"); },
    { feature_flags: [] },
  );

  return { provider, events, apps, clients };
}

test("AzureProvider.createDeployment mounts volumes into template and creates storage resources", async (): Promise<void> => {
  const { provider, events, apps } = createSetup();

  const volume: DeploymentVolume = {
    name: "data",
    mountPath: "/var/data",
    sizeGb: 32,
    accessMode: "ReadWrite",
  };

  const app: ContainerApp = await provider.createDeployment({
    userId: "12345",
    name: "sample-app",
    repo: "https://github.com/owner/repo",
    targetPort: 8080,
    volumes: [volume],
  });

  assert.equal(app.template?.volumes?.length, 1);
  assert.equal(app.template?.volumes?.[0]?.name, "data");
  assert.equal(app.template?.volumes?.[0]?.storageType, "AzureFile");
  assert.equal(app.template?.containers?.[0]?.volumeMounts?.length, 1);
  assert.equal(app.template?.containers?.[0]?.volumeMounts?.[0]?.mountPath, "/var/data");

  assert.ok(events.includes("storage-getProperties"));
  assert.ok(!events.includes("storage-listKeys"));
  assert.ok(events.includes("share-create:share-vol-data:32"));
  assert.ok(events.includes("env-storage-create:stg-sample-app-data:identity=system:hasKey=false"));
  assert.ok(events.includes("app-createOrUpdate"));
});

test("AzureProvider.createDeployment provisions FileStorage StandardV2_LRS account when account does not exist", async (): Promise<void> => {
  const { provider, events }: { provider: AzureProvider; events: string[] } = createSetup({ storageAccountExists: false });

  const volume: DeploymentVolume = {
    name: "data",
    mountPath: "/var/data",
    sizeGb: 32,
    accessMode: "ReadWrite",
  };

  await provider.createDeployment({
    userId: "12345",
    name: "sample-app",
    repo: "https://github.com/owner/repo",
    targetPort: 8080,
    volumes: [volume],
  });

  const expectedParams: string = JSON.stringify({
    location: "japaneast",
    sku: { name: "StandardV2_LRS" },
    kind: "FileStorage",
    minimumTlsVersion: "TLS1_2",
  });
  assert.ok(events.includes(`storage-create:${expectedParams}`));
});

test("AzureProvider.attachVolume adds volume to running app and updates revision", async (): Promise<void> => {
  const { provider, events, apps } = createSetup({ existingApp: true });

  const volume: DeploymentVolume = {
    name: "logs",
    mountPath: "/var/logs",
    sizeGb: 32,
    accessMode: "ReadWrite",
  };

  await provider.attachVolume({
    userId: "12345",
    appName: "sample-app",
    deploymentId: "dep-1",
    resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
    volume,
    existingVolumes: [],
  });

  const updated: ContainerApp = apps.get("sample-app")!;
  assert.equal(updated.template?.volumes?.length, 1);
  assert.equal(updated.template?.volumes?.[0]?.name, "logs");
  assert.equal(updated.template?.containers?.[0]?.volumeMounts?.length, 1);
  assert.equal(updated.template?.containers?.[0]?.volumeMounts?.[0]?.mountPath, "/var/logs");
  assert.ok(events.includes("env-storage-create:stg-sample-app-logs:identity=system:hasKey=false"));
  assert.ok(!events.includes("storage-listKeys"));
  assert.ok(events.includes("app-update"));
});

test("AzureProvider.detachVolume removes volume and deletes file share when deleteData=true", async (): Promise<void> => {
  const { provider, events, apps } = createSetup({ existingApp: true });

  // Attach a volume first
  const volume: DeploymentVolume = { name: "logs", mountPath: "/var/logs", sizeGb: 32 };
  await provider.attachVolume({
    userId: "12345",
    appName: "sample-app",
    deploymentId: "dep-1",
    resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
    volume,
    existingVolumes: [],
  });

  // Detach with deleteData: true
  await provider.detachVolume({
    userId: "12345",
    appName: "sample-app",
    deploymentId: "dep-1",
    resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
    volumeName: "logs",
    existingVolumes: [volume],
    deleteData: true,
  });

  const updated: ContainerApp = apps.get("sample-app")!;
  assert.equal(updated.template?.volumes?.length, 0);
  assert.equal(updated.template?.containers?.[0]?.volumeMounts?.length, 0);
  assert.ok(events.includes("env-storage-delete:stg-sample-app-logs"));
  assert.ok(events.includes("share-delete:share-vol-logs"));
});

test("AzureDeploymentConfigurationReader reads applied volumes from container", async (): Promise<void> => {
  const config: ConfigService = new ConfigService({
    AZURE_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000000",
    AZURE_PLATFORM_RESOURCE_GROUP: "platform-rg",
    AZURE_RG_NAME: "platform-rg",
  });

  const appsClient = {
    get: async () => ({
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
      name: "sample-app",
      location: "japaneast",
      tags: { "kumo-deployment-id": "dep-1" },
      template: {
        containers: [
          {
            name: "sample-app",
            image: "registry.azurecr.io/sample-app:sha",
            resources: { cpu: 0.5, memory: "1Gi" },
            volumeMounts: [{ volumeName: "data", mountPath: "/var/data", subPath: "sub" }],
          },
        ],
        volumes: [{ name: "data", storageType: "AzureFile", storageName: "stg-share" }],
      },
    }),
  } as unknown as ContainerAppsAPIClient["containerApps"];

  const reader: AzureDeploymentConfigurationReader = new AzureDeploymentConfigurationReader(config, appsClient);
  const result = await reader.read({
    resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
    deploymentId: "dep-1",
    userId: "12345",
    appName: "sample-app",
  });

  assert.equal(result.volumes?.length, 1);
  assert.equal(result.volumes?.[0]?.name, "data");
  assert.equal(result.volumes?.[0]?.mountPath, "/var/data");
  assert.equal(result.volumes?.[0]?.subPath, "sub");
});

test("AzureProvider.attachVolume registers environment storage via resources.createOrUpdateById with Managed Identity", async (): Promise<void> => {
  const { provider, events } = createSetup({ existingApp: true, useResourcesCreateOrUpdateById: true });

  const volume: DeploymentVolume = {
    name: "data",
    mountPath: "/var/data",
    sizeGb: 32,
    accessMode: "ReadWrite",
  };

  await provider.attachVolume({
    userId: "12345",
    appName: "sample-app",
    deploymentId: "dep-1",
    resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/user-rg-12345/providers/Microsoft.App/containerApps/sample-app",
    volume,
    existingVolumes: [],
  });

  const registeredEvent: string | undefined = events.find((e: string): boolean => e.startsWith("resource-createById:"));
  assert.ok(registeredEvent, "Expected resource-createById event");
  assert.ok(registeredEvent.includes(":2026-03-02-preview:"), "Expected 2026-03-02-preview apiVersion");
  assert.ok(registeredEvent.includes('"identity":"system"'), "Expected identity system in payload");
  assert.ok(!registeredEvent.includes('"accountKey"'), "Expected no accountKey in payload");
  assert.ok(!events.includes("storage-listKeys"), "Expected no storage-listKeys event");
});

test("AzureProvider.deleteStorageVolume deletes standalone share and matching app shares", async (): Promise<void> => {
  const setup: ReturnType<typeof createSetup> = createSetup({ existingApp: true });
  const deletedShares: string[] = [];
  setup.clients.fileShares = {
    create: async (): Promise<any> => ({}),
    get: async (): Promise<any> => ({}),
    delete: async (_rg: string, _acct: string, name: string): Promise<void> => {
      deletedShares.push(name);
    },
    list: (async function* (): AsyncGenerator<{ readonly name: string }> {
      yield { name: "share-vol-logs" };
      yield { name: "share-my-test-logs" };
      yield { name: "share-other-unrelated" };
    }) as any,
  };

  await setup.provider.deleteStorageVolume({
    userId: "12345",
    volumeName: "logs",
  });

  assert.ok(deletedShares.includes("share-vol-logs"));
  assert.ok(deletedShares.includes("share-my-test-logs"));
  assert.ok(!deletedShares.includes("share-other-unrelated"));
});
