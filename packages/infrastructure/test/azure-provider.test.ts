import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp, ManagedEnvironment } from "@azure/arm-appcontainers";
import type { GetBuildCase, TriggerBuildCase, TriggerBuildInput, TriggerBuildResult } from "@kumo/application";
import type { BuildDetails, BuildStatus } from "@kumo/domain";
import { AzureProvider, type AzureDeploymentCreateInput, type AzureProviderClients } from "../dist/azure/provider.js";

const ENVIRONMENT_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/managedEnvironments/user-aca-env-123";
const PULL_IDENTITY: string = "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.ManagedIdentity/userAssignedIdentities/acr-pull";
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
  const environment: ManagedEnvironment = { id: ENVIRONMENT_ID, location: "southeastasia", provisioningState: "Succeeded" };
  if (options.existingApp) apps.set(INPUT.name, { location: environment.location, environmentId: ENVIRONMENT_ID });
  const clients: AzureProviderClients = {
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
        events.push("env-create");
        return {
          pollUntilDone: async (): Promise<ManagedEnvironment> => {
            events.push("env-ready");
            environmentExists = true;
            return environment;
          },
        } as ReturnType<AzureProviderClients["managedEnvironments"]["createOrUpdate"]>;
      },
    },
    containerApps: {
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
    "rg-check", "rg-create", "env-get", "env-create", "env-ready", "app-get", "registry-check", "build-trigger",
    "build-PENDING", "build-PREPARING", "build-RUNNING", "build-SUCCEEDED", "app-create", "app-ready",
  ]);
  assert.equal(app.environmentId, ENVIRONMENT_ID);
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
  assert.equal(setup.apps.get("my-app")?.environmentId, setup.apps.get("second-app")?.environmentId);
});

test("an existing app is reused without rebuilding or updating the environment", async (): Promise<void> => {
  const setup: Fixture = fixture({ existingResources: true, existingApp: true });
  await setup.provider.createDeployment(INPUT);
  assert.deepEqual(setup.events, ["rg-check", "rg-get", "env-get", "app-get"]);
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
