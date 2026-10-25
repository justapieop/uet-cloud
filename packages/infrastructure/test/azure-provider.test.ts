import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, ManagedEnvironment } from "@azure/arm-appcontainers";
import type { VirtualNetwork } from "@azure/arm-network";
import type { GetBuildCase, TriggerBuildCase, TriggerBuildInput, TriggerBuildResult } from "@kumo/application";
import type { BuildDetails, BuildStatus } from "@kumo/domain";
import { AzureProvider, type AzureDeploymentCreateInput, type AzureProviderClients } from "../dist/azure/provider.js";

const ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/managedEnvironments/user-aca-env-123";
const PULL_IDENTITY: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.ManagedIdentity/userAssignedIdentities/acr-pull";
const VNET_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.Network/virtualNetworks/user-vnet-123";
const SUBNET_ID: string = `${VNET_ID}/subnets/aca-infrastructure`;
const INPUT: AzureDeploymentCreateInput = { name: "my-app", userId: "123", repo: "https://github.com/owner/repo", targetPort: 8080 };

interface FixtureOptions {
  existingResources?: boolean;
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
  existingNetwork?: boolean;
  network?: VirtualNetwork;
  networkError?: unknown;
  networkCreateError?: unknown;
  networkStates?: readonly string[];
  region?: string;
  environmentVnet?: boolean;
}

interface Fixture {
  provider: AzureProvider;
  events: string[];
  apps: Map<string, ContainerApp>;
}

function fixture(options: FixtureOptions = {}): Fixture {
  const events: string[] = [];
  const apps: Map<string, ContainerApp> = new Map();
  let rgExists: boolean = options.existingResources ?? false;
  let environmentExists: boolean = options.existingResources ?? false;
  let environmentReads: number = 0;
  let buildReads: number = 0;
  let networkExists: boolean = options.existingNetwork ?? false;
  let networkReads: number = 0;
  const environment: ManagedEnvironment = { id: ENVIRONMENT_ID, location: options.region ?? "southeastasia", provisioningState: "Succeeded",
    ...(options.environmentVnet ? { vnetConfiguration: { infrastructureSubnetId: SUBNET_ID } } : {}) };
  const network: VirtualNetwork = options.network ?? { id: VNET_ID, location: environment.location, provisioningState: "Succeeded",
    subnets: [{ id: SUBNET_ID, name: "aca-infrastructure", provisioningState: "Succeeded", addressPrefix: "10.0.0.0/24",
      delegations: [{ name: "container-apps", serviceName: "Microsoft.App/environments" }] }] };
  if (options.existingApp) apps.set(INPUT.name, { location: environment.location, environmentId: ENVIRONMENT_ID });
  const clients: AzureProviderClients = {
    virtualNetworks: {
      get: async (rg: string, name: string): Promise<VirtualNetwork> => {
        assert.equal(rg, "user-rg-123");
        assert.equal(name, "user-vnet-123");
        events.push("vnet-get");
        if (options.networkError) throw options.networkError;
        if (!networkExists) throw { statusCode: 404 };
        const states: readonly string[] = options.networkStates ?? [network.provisioningState ?? "Succeeded"];
        return { ...network, provisioningState: states[Math.min(networkReads++, states.length - 1)]! };
      },
      createOrUpdate: (rg: string, name: string, envelope: VirtualNetwork): ReturnType<AzureProviderClients["virtualNetworks"]["createOrUpdate"]> => {
        assert.equal(rg, "user-rg-123");
        assert.equal(name, "user-vnet-123");
        assert.equal(envelope.location, (options.region ?? "southeastasia").replace(/\s/g, "").toLowerCase());
        assert.deepEqual(envelope.addressSpace, { addressPrefixes: ["10.0.0.0/16"] });
        assert.deepEqual(envelope.subnets, [{ name: "aca-infrastructure", addressPrefix: "10.0.0.0/24",
          delegations: [{ name: "container-apps", serviceName: "Microsoft.App/environments" }] }]);
        events.push("vnet-create");
        return { pollUntilDone: async (): Promise<VirtualNetwork> => {
          if (options.networkCreateError) throw options.networkCreateError;
          events.push("vnet-ready");
          networkExists = true;
          return network;
        } } as ReturnType<AzureProviderClients["virtualNetworks"]["createOrUpdate"]>;
      },
    },
    resources: {
      getById: async () => {
        events.push("registry-check");
        return { properties: { loginServer: "registry.azurecr.io", anonymousPullEnabled: options.anonymousPullEnabled ?? false } };
      },
    },
    resourceGroups: {
      checkExistence: async (name: string): Promise<Awaited<ReturnType<AzureProviderClients["resourceGroups"]["checkExistence"]>>> => {
        assert.equal(name, "user-rg-123");
        events.push("rg-check");
        return { body: rgExists };
      },
      get: async (name: string) => {
        assert.equal(name, "user-rg-123");
        events.push("rg-get");
        return { location: environment.location };
      },
      createOrUpdate: async (name: string) => {
        assert.equal(name, "user-rg-123");
        events.push("rg-create");
        rgExists = true;
        return { location: environment.location };
      },
    },
    managedEnvironments: {
      get: async (rg: string, name: string): Promise<ManagedEnvironment> => {
        assert.equal(rg, "user-rg-123");
        assert.equal(name, "user-aca-env-123");
        events.push("env-get");
        if (options.environmentError) throw options.environmentError;
        if (!environmentExists) throw { statusCode: 404 };
        const states: readonly string[] = options.environmentStates ?? ["Succeeded"];
        const provisioningState: string = states[Math.min(environmentReads++, states.length - 1)]!;
        return { ...environment, provisioningState };
      },
      createOrUpdate: (rg: string, name: string, envelope: ManagedEnvironment): ReturnType<AzureProviderClients["managedEnvironments"]["createOrUpdate"]> => {
        assert.equal(rg, "user-rg-123");
        assert.equal(name, "user-aca-env-123");
        assert.equal(envelope.environmentMode, "WorkloadProfiles");
        assert.deepEqual(envelope.workloadProfiles, [{ name: "Consumption", workloadProfileType: "Consumption" }]);
        assert.deepEqual(envelope.vnetConfiguration, { infrastructureSubnetId: SUBNET_ID, internal: false });
        assert.ok(events.includes("vnet-ready") || options.existingNetwork);
        events.push("env-create");
        return {
          pollUntilDone: async (): Promise<ManagedEnvironment> => {
            events.push("env-ready");
            environmentExists = true;
            environment.vnetConfiguration = envelope.vnetConfiguration;
            return environment;
          },
        } as ReturnType<AzureProviderClients["managedEnvironments"]["createOrUpdate"]>;
      },
    },
    containerApps: {
      update: (rg: string, name: string, envelope: ContainerApp): ReturnType<AzureProviderClients["containerApps"]["update"]> => {
        assert.equal(rg, "user-rg-123");
        assert.equal(envelope.configuration, undefined);
        assert.equal(envelope.identity, undefined);
        events.push("app-update");
        const result: ContainerApp = { ...apps.get(name)!, ...envelope };
        apps.set(name, result);
        return { pollUntilDone: async (): Promise<ContainerApp> => result } as ReturnType<AzureProviderClients["containerApps"]["update"]>;
      },
      get: async (rg: string, name: string): Promise<ContainerApp> => {
        assert.equal(rg, "user-rg-123");
        events.push("app-get");
        if (options.appError) throw options.appError;
        const app: ContainerApp | undefined = apps.get(name);
        if (!app) throw { statusCode: 404 };
        return app;
      },
      createOrUpdate: (rg: string, name: string, envelope: ContainerApp): ReturnType<AzureProviderClients["containerApps"]["createOrUpdate"]> => {
        assert.equal(rg, "user-rg-123");
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
      assert.equal(input.userId, "123");
      assert.equal(input.repo, INPUT.repo);
      assert.equal("tag" in input, false);
      return { buildId: "build-id", image: "registry.azurecr.io/my-app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status: "PENDING", commitSha: null, runId: null, runUrl: null };
    },
  };
  const getBuild: Pick<GetBuildCase, "exec"> = {
    exec: async (id: string, userId: string): Promise<BuildDetails> => {
      assert.equal(id, "build-id");
      assert.equal(userId, "123");
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
    AZURE_PLATFORM_RESOURCE_GROUP: options.platformResourceGroup ?? "platform",
    AZURE_SUBSCRIPTION_ID: "sub",
    AZURE_CONTAINER_REGISTRY_SERVER: "registry.azurecr.io",
    AZURE_CONTAINER_REGISTRY_RESOURCE_ID: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.ContainerRegistry/registries/registry",
    AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME: options.pullIdentityName ?? "acr-pull",
    AZURE_DEPLOYMENT_TIMEOUT_MS: String(options.timeoutMs ?? 1000),
    AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "1",
  });
  return { provider: new AzureProvider(config, trigger, getBuild, clients), events, apps };
}

test("missing resources are created in order and the app waits for build success", async (): Promise<void> => {
  const setup: Fixture = fixture();
  const app: ContainerApp = await setup.provider.createDeployment({ ...INPUT, envVars: { NODE_ENV: "production" } });
  assert.deepEqual(setup.events, [
    "rg-check", "rg-create", "env-get", "vnet-get", "vnet-create", "vnet-ready", "env-create", "env-ready", "app-get", "registry-check", "build-trigger",
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
  assert.equal(setup.events.filter((event: string): boolean => event === "env-create").length, 1);
  assert.equal(setup.events.filter((event: string): boolean => event === "vnet-create").length, 1);
  assert.equal(setup.apps.get("my-app")?.environmentId, setup.apps.get("second-app")?.environmentId);
});

test("an existing app is reused without rebuilding or updating the environment", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, existingApp: true });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events, ["rg-check", "rg-get", "env-get", "app-get"]);
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

test("a ready existing user VNet is reused before creating the managed environment", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingNetwork: true });
  await setup.provider.createDeployment(INPUT);
  assert.equal(setup.events.includes("vnet-create"), false);
  assert.ok(setup.events.indexOf("vnet-get") < setup.events.indexOf("env-create"));
});

test("VNet provisioning is awaited before environment creation", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingNetwork: true, networkStates: ["Updating", "Succeeded"] });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events.slice(0, 6), ["rg-check", "rg-create", "env-get", "vnet-get", "vnet-get", "env-create"]);
});

test("VNet read and creation failures stop before environment creation and building", async (): Promise<void> => {
  const failure: Error & { statusCode: number } = Object.assign(new Error("Forbidden"), { statusCode: 403 });
  const denied: Fixture = fixture({ networkError: failure });
  await assert.rejects(denied.provider.createDeployment(INPUT), (error: unknown): boolean => error instanceof Error && error.cause === failure);
  assert.equal(denied.events.includes("vnet-create"), false);
  assert.equal(denied.events.includes("env-create"), false);
  const failed: Fixture = fixture({ networkCreateError: failure });
  await assert.rejects(failed.provider.createDeployment(INPUT), /Virtual network creation failed/);
  assert.equal(failed.events.includes("env-create"), false);
  assert.equal(failed.events.includes("build-trigger"), false);
});

test("incompatible existing VNets fail without rewriting resources or building", async (): Promise<void> => {
  const valid: VirtualNetwork = { id: VNET_ID, location: "southeastasia", provisioningState: "Succeeded", subnets: [
    { id: SUBNET_ID, name: "aca-infrastructure", provisioningState: "Succeeded", addressPrefix: "10.0.0.0/24",
      delegations: [{ name: "container-apps", serviceName: "Microsoft.App/environments" }] },
  ] };
  const cases: { network: VirtualNetwork; error: RegExp }[] = [
    { network: { ...valid, id: VNET_ID.replace("user-rg-123", "platform") }, error: /identity or region/ },
    { network: { ...valid, location: "eastus" }, error: /identity or region/ },
    { network: { ...valid, provisioningState: "Failed" }, error: /not ready: Failed/ },
    { network: { ...valid, subnets: [] }, error: /dedicated aca-infrastructure subnet/ },
    { network: { ...valid, subnets: [{ ...valid.subnets![0]!, delegations: [] }] }, error: /delegated/ },
    { network: { ...valid, subnets: [{ ...valid.subnets![0]!, addressPrefix: "10.0.0.0/28" }] }, error: /27 or larger/ },
    { network: { ...valid, subnets: [{ ...valid.subnets![0]!, id: `${VNET_ID}/subnets/foreign` }] }, error: /dedicated/ },
  ];
  for (let index: number = 0; index < cases.length; index++) {
    const entry: typeof cases[number] = cases[index]!;
    const setup: Fixture = fixture({ existingNetwork: true, network: entry.network });
    await assert.rejects(setup.provider.createDeployment(INPUT), entry.error);
    assert.equal(setup.events.includes("vnet-create"), false);
    assert.equal(setup.events.includes("env-create"), false);
    assert.equal(setup.events.includes("build-trigger"), false);
  }
});

test("new VNet-connected environments support external additional TCP ports", async (): Promise<void> => {
  const setup: Fixture = fixture();
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
  assert.deepEqual(setup.events, ["rg-check", "rg-get", "env-get"]);
});

test("network and environment creation use the requested normalized region", async (): Promise<void> => {
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
  assert.deepEqual(setup.events, ["rg-check", "rg-get", "env-get"]);
  const deniedApp: Fixture = fixture({ existingResources: true, appError: failure });
  await assert.rejects(deniedApp.provider.createDeployment(INPUT), (error: unknown): boolean => error instanceof Error && error.cause === failure);
  assert.equal(deniedApp.events.includes("build-trigger"), false);
});

test("an environment already provisioning is awaited without another create operation", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, environmentStates: ["Waiting", "Succeeded"], statuses: ["SUCCEEDED"] });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events.slice(0, 5), ["rg-check", "rg-get", "env-get", "env-get", "app-get"]);
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
