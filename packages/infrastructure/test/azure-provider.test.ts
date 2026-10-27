import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, ManagedEnvironment } from "@azure/arm-appcontainers";
import type { GetBuildCase, TriggerBuildCase, TriggerBuildInput, TriggerBuildResult } from "@kumo/application";
import type { BuildDetails, BuildStatus } from "@kumo/domain";
import type { FeatureFlagConfiguration } from "../dist/feature-flags/provider.js";
import type { AzureLegacyEnvironmentProvisioner } from "../dist/azure/legacy-environment.js";
import { AzureProvider, type AzureDeploymentCreateInput, type AzureProviderClients } from "../dist/azure/provider.js";

const ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared-env";
const LEGACY_ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/managedEnvironments/user-aca-env-123";
const PULL_IDENTITY: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.ManagedIdentity/userAssignedIdentities/acr-pull";
const VNET_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.Network/virtualNetworks/user-vnet-123";
const SUBNET_ID: string = `${VNET_ID}/subnets/aca-infrastructure`;
const INPUT: AzureDeploymentCreateInput = { name: "my-app", userId: "123", repo: "https://github.com/owner/repo", targetPort: 8080 };

interface FixtureOptions {
  existingResources?: boolean;
  enableLegacy?: boolean;
  featureFlags?: FeatureFlagConfiguration;
  legacyProvider?: Pick<AzureLegacyEnvironmentProvisioner, "getAcaEnvironment">;
  userId?: string;
  sharedId?: string;
  existingApp?: boolean;
  statuses?: readonly BuildStatus[];
  environmentStates?: readonly string[];
  environmentError?: unknown;
  appError?: unknown;
  platformResourceGroup?: string;
  timeoutMs?: number;
  anonymousPullEnabled?: boolean;
  pullIdentityName?: string;
  onBuildRead?: () => void;
  legacy?: boolean;
  environmentMissing?: boolean;
  responseEnvironmentId?: string;
  environmentMode?: "Express";
  noConsumptionProfile?: boolean;
  consumptionProfileName?: string;
  region?: string;
  environmentVnet?: boolean;
}

interface Fixture {
  provider: AzureProvider;
  events: string[];
  apps: Map<string, ContainerApp>;
}

function fixture(options: FixtureOptions = {}): Fixture {
  const userId: string = options.userId ?? "123";
  const configuredId: string = options.sharedId ?? ENVIRONMENT_ID;
  const events: string[] = [];
  const apps: Map<string, ContainerApp> = new Map();
  let rgExists: boolean = options.existingResources ?? false;
  let environmentReads: number = 0;
  let buildReads: number = 0;
  const environmentId: string = options.legacy ? LEGACY_ENVIRONMENT_ID : configuredId;
  const environment: ManagedEnvironment = { id: options.responseEnvironmentId ?? environmentId,
    location: options.region ?? "southeastasia", provisioningState: "Succeeded", environmentMode: options.environmentMode,
    workloadProfiles: options.noConsumptionProfile ? [] : [{ name: options.consumptionProfileName ?? "Consumption", workloadProfileType: "Consumption" }],
    ...(options.environmentVnet ? { vnetConfiguration: { infrastructureSubnetId: SUBNET_ID } } : {}) };
  if (options.existingApp) apps.set(INPUT.name, { location: environment.location, environmentId });
  const clients: AzureProviderClients = {
    resources: {
      getById: async () => {
        events.push("registry-check");
        return { properties: { loginServer: "registry.azurecr.io", anonymousPullEnabled: options.anonymousPullEnabled ?? false } };
      },
    },
    resourceGroups: {
      checkExistence: async (name: string): Promise<Awaited<ReturnType<AzureProviderClients["resourceGroups"]["checkExistence"]>>> => {
        assert.equal(name, `user-rg-${userId}`);
        events.push("rg-check");
        return { body: rgExists };
      },
      get: async (name: string) => {
        assert.equal(name, `user-rg-${userId}`);
        events.push("rg-get");
        return { location: environment.location };
      },
      createOrUpdate: async (name: string, envelope: { location: string }) => {
        assert.equal(name, `user-rg-${userId}`);
        assert.equal(envelope.location, environment.location!.replace(/\s+/g, "").toLowerCase());
        events.push("rg-create");
        rgExists = true;
        return { location: environment.location };
      },
    },
    managedEnvironments: {
      get: async (rg: string, name: string): Promise<ManagedEnvironment> => {
        assert.equal(rg, environmentId.split("/")[4]);
        assert.equal(name, environmentId.split("/")[8]);
        events.push("env-get");
        if (options.environmentError) throw options.environmentError;
        if (options.environmentMissing) throw { statusCode: 404 };
        const states: readonly string[] = options.environmentStates ?? ["Succeeded"];
        const provisioningState: string = states[Math.min(environmentReads++, states.length - 1)]!;
        return { ...environment, provisioningState };
      },
    },
    containerApps: {
      update: (rg: string, name: string, envelope: ContainerApp): ReturnType<AzureProviderClients["containerApps"]["update"]> => {
        assert.equal(rg, `user-rg-${userId}`);
        assert.equal(envelope.configuration, undefined);
        assert.equal(envelope.identity, undefined);
        events.push("app-update");
        const result: ContainerApp = { ...apps.get(name)!, ...envelope };
        apps.set(name, result);
        return { pollUntilDone: async (): Promise<ContainerApp> => result } as ReturnType<AzureProviderClients["containerApps"]["update"]>;
      },
      get: async (rg: string, name: string): Promise<ContainerApp> => {
        assert.equal(rg, `user-rg-${userId}`);
        events.push("app-get");
        if (options.appError) throw options.appError;
        const app: ContainerApp | undefined = apps.get(name);
        if (!app) throw { statusCode: 404 };
        return app;
      },
      createOrUpdate: (rg: string, name: string, envelope: ContainerApp): ReturnType<AzureProviderClients["containerApps"]["createOrUpdate"]> => {
        assert.equal(rg, `user-rg-${userId}`);
        events.push("app-create");
        apps.set(name, envelope);
        return {
          pollUntilDone: async (): Promise<ContainerApp> => {
            events.push("app-ready");
            return envelope;
          },
        } as ReturnType<AzureProviderClients["containerApps"]["createOrUpdate"]>;
      },
    },
  };
  const trigger: Pick<TriggerBuildCase, "exec"> = {
    exec: async (input: TriggerBuildInput): Promise<TriggerBuildResult> => {
      events.push("build-trigger");
      assert.equal(input.userId, userId);
      assert.equal(input.repo, INPUT.repo);
      assert.equal("tag" in input, false);
      return { buildId: "build-id", image: "registry.azurecr.io/my-app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status: "PENDING", commitSha: null, runId: null, runUrl: null };
    },
  };
  const getBuild: Pick<GetBuildCase, "exec"> = {
    exec: async (id: string, userId: string): Promise<BuildDetails> => {
      assert.equal(id, "build-id");
      assert.equal(userId, options.userId ?? "123");
      const statuses: readonly BuildStatus[] = options.statuses ?? ["PENDING", "PREPARING", "RUNNING", "SUCCEEDED"];
      const status: BuildStatus = statuses[Math.min(buildReads++, statuses.length - 1)]!;
      events.push(`build-${status}`);
      options.onBuildRead?.();
      return {
        id, userId, repo: INPUT.repo, commitSha: "a".repeat(40), ref: null, error: status === "FAILED" ? "Docker build failed" : null,
        dockerFilePath: "Dockerfile", image: "registry.azurecr.io/my-app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status,
        sourceTokenHash: "a".repeat(64), sourceExpiresAt: new Date(Date.now() + 60_000),
        runId: "42", runUrl: "https://dev.azure.com/run/42", createdAt: new Date(), updatedAt: new Date(),
      };
    },
  };
  const config: ConfigService = new ConfigService({
    AZURE_PLATFORM_RESOURCE_GROUP: options.platformResourceGroup ?? configuredId.split("/")[4],
    AZURE_SUBSCRIPTION_ID: "sub",
    AZURE_SHARED_ENVIRONMENT_NAME: configuredId.split("/")[8],
    AZURE_CONTAINER_REGISTRY_SERVER: "registry.azurecr.io",
    AZURE_CONTAINER_REGISTRY_RESOURCE_ID: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.ContainerRegistry/registries/registry",
    AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME: options.pullIdentityName ?? "acr-pull",
    AZURE_DEPLOYMENT_TIMEOUT_MS: String(options.timeoutMs ?? 1000),
    AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "1",
  });
  const flags: FeatureFlagConfiguration = options.featureFlags ?? { feature_flags: [{ id: "LegacyPerUserProvisioning", enabled: options.enableLegacy ?? false }] };
  return { provider: new AzureProvider(config, trigger, getBuild, clients, (): Pick<AzureLegacyEnvironmentProvisioner, "getAcaEnvironment"> => {
    if (!options.legacyProvider) throw new Error("Legacy provisioning provider is not configured");
    return options.legacyProvider;
  }, flags), events, apps };
}

test("new apps reuse the shared environment and build before app creation", async (): Promise<void> => {
  const setup: Fixture = fixture();
  const app: ContainerApp = await setup.provider.createDeployment({ ...INPUT, envVars: { NODE_ENV: "production" } });
  assert.deepEqual(setup.events, [
    "app-get", "env-get", "rg-check", "rg-create", "registry-check", "build-trigger",
    "build-PENDING", "build-PREPARING", "build-RUNNING", "build-SUCCEEDED", "app-create", "app-ready",
  ]);
  assert.equal(app.environmentId, ENVIRONMENT_ID);
  assert.equal(app.configuration?.ingress?.external, true);
  assert.equal(app.template?.containers?.[0]?.image, "registry.azurecr.io/my-app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(app.template?.containers?.[0]?.env, [{ name: "NODE_ENV", value: "production" }]);
  assert.deepEqual(app.configuration?.registries, [{ server: "registry.azurecr.io", identity: PULL_IDENTITY }]);
  assert.deepEqual(app.configuration?.identitySettings, [{ identity: PULL_IDENTITY, lifecycle: "None" }]);
  assert.deepEqual(app.identity, { type: "UserAssigned", userAssignedIdentities: { [PULL_IDENTITY]: {} } });
});

test("multiple apps reuse their user's resource group and managed environment", async (): Promise<void> => {
  const setup: Fixture = fixture();
  await setup.provider.createDeployment(INPUT);
  await setup.provider.createDeployment({ ...INPUT, name: "second-app" });
  assert.equal(setup.events.filter((event: string): boolean => event === "rg-create").length, 1);
  assert.equal(setup.events.filter((event: string): boolean => event === "env-create").length, 0);
  assert.equal(setup.events.filter((event: string): boolean => event === "vnet-create").length, 0);
  assert.equal(setup.apps.get("my-app")?.environmentId, setup.apps.get("second-app")?.environmentId);
});

test("an existing app is reused without rebuilding or updating the environment", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, existingApp: true });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events, ["app-get", "env-get"]);
});

test("redeployment rebuilds then updates only its owned app image while preserving live settings", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, existingApp: true });
  const resourceId: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app";
  const original: ContainerApp = { id: resourceId, location: "southeastasia", environmentId: ENVIRONMENT_ID, provisioningState: "Succeeded",
    tags: { "kumo-deployment-id": "deployment", "kumo-build-id": "old-build", custom: "kept" },
    configuration: { ingress: { external: false, targetPort: 8080, additionalPortMappings: [{ targetPort: 9000, external: false }] }, secrets: [{ name: "secret", value: "retained" }], activeRevisionsMode: "Single" },
    template: { containers: [{ name: "my-app", image: "old-image", resources: { cpu: 1, memory: "2Gi" }, env: [{ name: "MY_VALUE", value: "kept" }], volumeMounts: [{ volumeName: "data", mountPath: "/data" }] }],
      scale: { minReplicas: 1, maxReplicas: 3 }, volumes: [{ name: "data", storageType: "AzureFile", storageName: "share" }] },
  };
  setup.apps.set(INPUT.name, original);
  const updated: ContainerApp = await setup.provider.createDeployment({ ...INPUT, resourceId, deploymentId: "deployment" });
  assert.ok(setup.events.indexOf("build-SUCCEEDED") < setup.events.indexOf("app-update"));
  assert.equal(updated.template?.containers?.[0]?.image, "registry.azurecr.io/my-app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(updated.configuration, original.configuration);
  assert.deepEqual(updated.template?.volumes, original.template?.volumes);
  assert.deepEqual(updated.template?.scale, original.template?.scale);
  assert.deepEqual(updated.template?.containers?.[0]?.env, original.template?.containers?.[0]?.env);
  assert.deepEqual(updated.template?.containers?.[0]?.resources, original.template?.containers?.[0]?.resources);
  assert.equal(updated.tags?.custom, "kept");
  assert.equal(updated.tags?.["kumo-build-id"], "build-id");
});

test("a failed redeployment build never updates the existing app and foreign resource IDs never reach Azure", async (): Promise<void> => {
  const resourceId: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app";
  const failed: Fixture = fixture({ existingResources: true, existingApp: true, statuses: ["FAILED"] });
  failed.apps.set(INPUT.name, { id: resourceId, location: "southeastasia", environmentId: ENVIRONMENT_ID, tags: { "kumo-deployment-id": "deployment" } });
  await assert.rejects(failed.provider.createDeployment({ ...INPUT, resourceId, deploymentId: "deployment" }), /Build build-id failed/);
  assert.equal(failed.events.includes("app-create"), false);
  assert.equal(failed.events.includes("app-update"), false);
  const foreign: Fixture = fixture();
  await assert.rejects(foreign.provider.createDeployment({ ...INPUT, resourceId: resourceId.replace("user-rg-123", "user-rg-456"), deploymentId: "deployment" }), /does not belong/);
  assert.deepEqual(foreign.events, []);
});

test("VNet-connected shared environments support external additional TCP ports", async (): Promise<void> => {
  const setup: Fixture = fixture({ environmentVnet: true });
  const app: ContainerApp = await setup.provider.createDeployment({ ...INPUT,
    additionalPorts: [{ targetPort: 9090, exposedPort: 9091, external: true }],
  });
  assert.deepEqual(app.configuration?.ingress?.additionalPortMappings, [{ targetPort: 9090, exposedPort: 9091, external: true }]);
  assert.equal(app.configuration?.ingress?.external, true);
});

test("internal containers configure internal ingress and reject external additional ports before Azure access", async (): Promise<void> => {
  const setup: Fixture = fixture();
  await assert.rejects(setup.provider.createDeployment({ ...INPUT, external: false, additionalPorts: [{ targetPort: 9090, external: true }] }), /require an external container/);
  assert.deepEqual(setup.events, []);
  const app: ContainerApp = await setup.provider.createDeployment({ ...INPUT, external: false, additionalPorts: [{ targetPort: 9090 }] });
  assert.equal(app.configuration?.ingress?.external, false);
  assert.deepEqual(app.configuration?.ingress?.additionalPortMappings, [{ targetPort: 9090, exposedPort: 9090, external: false }]);
});

test("legacy environments without VNet are preserved and external ports fail before building", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true });
  await assert.rejects(setup.provider.createDeployment({ ...INPUT, additionalPorts: [{ targetPort: 9090, external: true }] }), /virtual network/);
  assert.deepEqual(setup.events, ["app-get", "env-get"]);
});

test("apps use the shared environment normalized region", async (): Promise<void> => {
  const setup: Fixture = fixture({ region: "Japan East" });
  const app: ContainerApp = await setup.provider.createDeployment({ ...INPUT, region: "japaneast" });
  assert.equal(app.location, "japaneast");
});

const FAILED_STATUSES: readonly BuildStatus[] = ["FAILED", "CANCELED"];
FAILED_STATUSES.forEach((status: BuildStatus): void => {
  test(`a ${status} build never creates a Container App`, async (): Promise<void> => {
    const setup: Fixture = fixture({ statuses: [status] });
    await assert.rejects(setup.provider.createDeployment(INPUT), /Build build-id (failed|canceled)/);
    assert.equal(setup.events.includes("app-create"), false);
  });
});

test("permission errors propagate without creating or rebuilding resources", async (): Promise<void> => {
  const failure: Error & { statusCode: number } = Object.assign(new Error("Forbidden"), { statusCode: 403 });
  const setup: Fixture = fixture({ existingResources: true, environmentError: failure });
  await assert.rejects(setup.provider.createDeployment(INPUT), (error: unknown): boolean => error instanceof Error && error.cause === failure);
  assert.deepEqual(setup.events, ["app-get", "env-get"]);
  const deniedApp: Fixture = fixture({ existingResources: true, appError: failure });
  await assert.rejects(deniedApp.provider.createDeployment(INPUT), (error: unknown): boolean => error instanceof Error && error.cause === failure);
  assert.equal(deniedApp.events.includes("build-trigger"), false);
});

test("an environment already provisioning is awaited without another create operation", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, environmentStates: ["Waiting", "Succeeded"], statuses: ["SUCCEEDED"] });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events.slice(0, 3), ["app-get", "env-get", "env-get"]);
  assert.equal(setup.events.includes("env-create"), false);
});

test("an unhealthy environment prevents building or creating an app", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, environmentStates: ["Failed"] });
  await assert.rejects(setup.provider.createDeployment(INPUT), /not ready: Failed/);
  assert.equal(setup.events.includes("build-trigger"), false);
  assert.equal(setup.events.includes("app-create"), false);
});

test("canceling while waiting for a build prevents Container App creation", async (): Promise<void> => {
  const cancellation: AbortController = new AbortController();
  const setup: Fixture = fixture({ statuses: ["RUNNING"], onBuildRead: (): void => cancellation.abort() });
  await assert.rejects(setup.provider.createDeployment({ ...INPUT, abortSignal: cancellation.signal }), /Build completion wait failed/);
  assert.equal(setup.events.includes("app-create"), false);
});

test("build waiting is bounded and timeout prevents Container App creation", async (): Promise<void> => {
  const setup: Fixture = fixture({ statuses: ["RUNNING"], timeoutMs: 30 });
  await assert.rejects(setup.provider.createDeployment(INPUT), /Build completion wait failed/);
  assert.equal(setup.events.includes("app-create"), false);
});

test("invalid app names and attempts to target the platform RG fail before Azure calls", async (): Promise<void> => {
  const setup: Fixture = fixture();
  await assert.rejects(setup.provider.createDeployment({ ...INPUT, name: "INVALID" }), /Container App name/);
  assert.deepEqual(setup.events, []);
  const forbidden: Fixture = fixture({ platformResourceGroup: "USER-RG-123" });
  await assert.rejects(forbidden.provider.createDeployment(INPUT), /platform resource group/);
  assert.deepEqual(forbidden.events, []);
});

test("a registry with anonymous pulls enabled is rejected before building or creating an app", async (): Promise<void> => {
  const setup: Fixture = fixture({ anonymousPullEnabled: true });
  await assert.rejects(setup.provider.createDeployment(INPUT), /anonymous pull disabled/);
  assert.equal(setup.events.includes("build-trigger"), false);
  assert.equal(setup.events.includes("app-create"), false);
});

test("the pull identity setting accepts a name rather than a resource path", async (): Promise<void> => {
  const setup: Fixture = fixture({ pullIdentityName: PULL_IDENTITY });
  await assert.rejects(setup.provider.createDeployment(INPUT), /pull identity name/);
  assert.deepEqual(setup.events, []);
});


test("different users use the configured shared ID and live region while keeping their own app groups", async (): Promise<void> => {
  const sharedId: string = "/subscriptions/sub/resourceGroups/custom-infra/providers/Microsoft.App/managedEnvironments/custom-pool";
  const first: Fixture = fixture({ userId: "123", sharedId, region: "West Europe", consumptionProfileName: "LiveProfile" });
  const second: Fixture = fixture({ userId: "456", sharedId, region: "West Europe", consumptionProfileName: "LiveProfile" });
  const apps: ContainerApp[] = await Promise.all([
    first.provider.createDeployment(INPUT), second.provider.createDeployment({ ...INPUT, userId: "456", name: "other-app" }),
  ]);
  assert.ok(apps.every((app: ContainerApp): boolean => app.environmentId === sharedId && app.location === "westeurope" && app.workloadProfileName === "LiveProfile"));
});

test("missing, unhealthy or mismatched shared environments stop before creating groups or starting builds", async (): Promise<void> => {
  const options: FixtureOptions[] = [
    { environmentMissing: true }, { environmentMode: "Express" }, { noConsumptionProfile: true },
    { responseEnvironmentId: ENVIRONMENT_ID.replace("/platform/", "/foreign/") },
    { responseEnvironmentId: ENVIRONMENT_ID.replace("/sub/", "/other/") },
  ];
  for (let index: number = 0; index < options.length; index++) {
    const setup: Fixture = fixture(options[index]);
    await assert.rejects(setup.provider.createDeployment(INPUT), /environment|Environment|Consumption/);
    assert.equal(setup.events.includes("rg-create"), false);
    assert.equal(setup.events.includes("build-trigger"), false);
  }
  const mismatch: Fixture = fixture({ region: "Japan East" });
  await assert.rejects(mismatch.provider.createDeployment({ ...INPUT, region: "westeurope" }), /requested region/);
  assert.equal(mismatch.events.includes("rg-create"), false);
});

test("legacy app redeployment retains its existing environment without moving it to the shared pool", async (): Promise<void> => {
  const setup: Fixture = fixture({ legacy: true, existingResources: true, existingApp: true });
  const resourceId: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app";
  setup.apps.set(INPUT.name, { id: resourceId, location: "southeastasia", environmentId: LEGACY_ENVIRONMENT_ID,
    tags: { "kumo-deployment-id": "deployment" }, template: { containers: [{ name: "my-app", image: "old" }] } });
  const result: ContainerApp = await setup.provider.createDeployment({ ...INPUT, deploymentId: "deployment", resourceId });
  assert.equal(result.environmentId, LEGACY_ENVIRONMENT_ID);
  assert.deepEqual(setup.events.slice(0, 2), ["app-get", "env-get"]);
  assert.equal(setup.events.includes("rg-create"), false);
});

test("an existing app cannot select another user's environment or another platform environment", async (): Promise<void> => {
  const ids: string[] = [LEGACY_ENVIRONMENT_ID.replace(/123/g, "456"), ENVIRONMENT_ID.replace("shared-env", "another-env")];
  for (let index: number = 0; index < ids.length; index++) {
    const setup: Fixture = fixture({ existingApp: true });
    setup.apps.set(INPUT.name, { location: "southeastasia", environmentId: ids[index] });
    await assert.rejects(setup.provider.createDeployment(INPUT), /allowed managed environment/);
    assert.deepEqual(setup.events, ["app-get"]);
  }
});


test("legacy resource creation is opt-in and is never a shared-environment failure fallback", async (): Promise<void> => {
  let calls: number = 0;
  const legacyProvider: Pick<AzureLegacyEnvironmentProvisioner, "getAcaEnvironment"> = { getAcaEnvironment: async (): Promise<ManagedEnvironment> => {
    calls++;
    return { id: LEGACY_ENVIRONMENT_ID, location: "southeastasia", provisioningState: "Succeeded",
      workloadProfiles: [{ name: "Consumption", workloadProfileType: "Consumption" }] };
  } };
  const disabled: Fixture = fixture({ legacyProvider });
  assert.equal((await disabled.provider.createDeployment(INPUT)).environmentId, ENVIRONMENT_ID);
  assert.equal(calls, 0);
  const unavailable: Fixture = fixture({ legacyProvider, environmentMissing: true });
  await assert.rejects(unavailable.provider.createDeployment(INPUT));
  assert.equal(calls, 0);
  const enabled: Fixture = fixture({ legacyProvider, enableLegacy: true });
  assert.equal((await enabled.provider.createDeployment(INPUT)).environmentId, LEGACY_ENVIRONMENT_ID);
  assert.equal(calls, 1);
  const incomplete: Fixture = fixture({ enableLegacy: true });
  await assert.rejects(incomplete.provider.createDeployment(INPUT), /Legacy provisioning provider is not configured/);
});


test("provisioning follows refreshed flags without reconstructing the provider", async (): Promise<void> => {
  let enabled: boolean = false;
  const flags: FeatureFlagConfiguration = { get feature_flags(): readonly unknown[] { return [{ id: "LegacyPerUserProvisioning", enabled }]; } };
  let calls: number = 0;
  const setup: Fixture = fixture({ featureFlags: flags, legacyProvider: { getAcaEnvironment: async (): Promise<ManagedEnvironment> => {
    calls++;
    return { id: LEGACY_ENVIRONMENT_ID, location: "southeastasia", provisioningState: "Succeeded" };
  } } });
  assert.equal((await setup.provider.getAcaEnvironment(INPUT)).id, ENVIRONMENT_ID);
  assert.equal(calls, 0);
  enabled = true;
  assert.equal((await setup.provider.getAcaEnvironment(INPUT)).id, LEGACY_ENVIRONMENT_ID);
  assert.equal(calls, 1);
  enabled = false;
  assert.equal((await setup.provider.getAcaEnvironment(INPUT)).id, ENVIRONMENT_ID);
  assert.equal(calls, 1);
});
