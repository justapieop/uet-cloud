import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp } from "@azure/arm-appcontainers";
import { BuildProviderError, type TriggerBuildCase, type GetBuildCase } from "@kumo/application";
import { AzureProvider, type AzureProviderClients } from "../dist/azure/provider.js";

interface LifecycleFixture {
  provider: AzureProvider;
  calls: { start: string[]; stop: string[] };
}

function createFixture(overrides: {
  startError?: unknown;
  stopError?: unknown;
} = {}): LifecycleFixture {
  const calls: { start: string[]; stop: string[] } = { start: [], stop: [] };

  const clients: AzureProviderClients = {
    resources: {
      getById: async (): Promise<never> => {
        throw new Error("not implemented");
      },
    },
    resourceGroups: {
      checkExistence: async (): Promise<never> => {
        throw new Error("not implemented");
      },
      get: async (): Promise<never> => {
        throw new Error("not implemented");
      },
      createOrUpdate: async (): Promise<never> => {
        throw new Error("not implemented");
      },
    },
    managedEnvironments: {
      get: async (): Promise<never> => {
        throw new Error("not implemented");
      },
      createOrUpdate: (): never => {
        throw new Error("not implemented");
      },
    },
    containerApps: {
      get: async (): Promise<never> => {
        throw new Error("not implemented");
      },
      createOrUpdate: (): never => {
        throw new Error("not implemented");
      },
      start: (rg: string, app: string): ReturnType<AzureProviderClients["containerApps"]["start"]> => ({
        pollUntilDone: async (): Promise<ContainerApp> => {
          if (overrides.startError) throw overrides.startError;
          calls.start.push(`${rg}/${app}`);
          return { name: app, location: "southeastasia" };
        },
      } as ReturnType<AzureProviderClients["containerApps"]["start"]>),
      stop: (rg: string, app: string): ReturnType<AzureProviderClients["containerApps"]["stop"]> => ({
        pollUntilDone: async (): Promise<ContainerApp> => {
          if (overrides.stopError) throw overrides.stopError;
          calls.stop.push(`${rg}/${app}`);
          return { name: app, location: "southeastasia" };
        },
      } as ReturnType<AzureProviderClients["containerApps"]["stop"]>),
    },
  };

  const config: ConfigService = new ConfigService({
    AZURE_RG_NAME: "central-rg",
    AZURE_DEPLOYMENT_TIMEOUT_MS: "5000",
    AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "100",
  });

  const triggerBuild: Pick<TriggerBuildCase, "exec"> = { exec: async (): Promise<never> => { throw new Error("not needed"); } };
  const getBuild: Pick<GetBuildCase, "exec"> = { exec: async (): Promise<never> => { throw new Error("not needed"); } };

  const provider: AzureProvider = new AzureProvider(config, triggerBuild, getBuild, clients);
  return { provider, calls };
}

test("AzureProvider.startApp calls containerApps.start with correct resource group and app name", async (): Promise<void> => {
  const { provider, calls }: LifecycleFixture = createFixture();
  await provider.startApp("123", "my-app");
  assert.deepEqual(calls.start, ["user-rg-123/my-app"]);
  assert.deepEqual(calls.stop, []);
});

test("AzureProvider.stopApp calls containerApps.stop with correct resource group and app name", async (): Promise<void> => {
  const { provider, calls }: LifecycleFixture = createFixture();
  await provider.stopApp("123", "my-app");
  assert.deepEqual(calls.stop, ["user-rg-123/my-app"]);
  assert.deepEqual(calls.start, []);
});

test("AzureProvider.startApp wraps Azure errors in BuildProviderError", async (): Promise<void> => {
  const { provider }: LifecycleFixture = createFixture({
    startError: new Error("ARM start failed"),
  });
  await assert.rejects(
    provider.startApp("123", "my-app"),
    (err: unknown): boolean => err instanceof BuildProviderError && err.message.includes("Container App start failed"),
  );
});

test("AzureProvider.stopApp wraps Azure errors in BuildProviderError", async (): Promise<void> => {
  const { provider }: LifecycleFixture = createFixture({
    stopError: new Error("ARM stop failed"),
  });
  await assert.rejects(
    provider.stopApp("123", "my-app"),
    (err: unknown): boolean => err instanceof BuildProviderError && err.message.includes("Container App stop failed"),
  );
});
