import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ContainerApp } from "@azure/arm-appcontainers";
import { BuildProviderError } from "@kumo/application";
import { AzureContainerLifecycleManager, type ContainerAppLifecycleClient } from "../dist/azure/container-lifecycle.js";

interface LifecycleFixture {
  provider: AzureContainerLifecycleManager;
  calls: { start: string[]; stop: string[] };
}

function createFixture(overrides: {
  startError?: unknown;
  stopError?: unknown;
} = {}): LifecycleFixture {
  const calls: { start: string[]; stop: string[] } = { start: [], stop: [] };

  const clients: ContainerAppLifecycleClient = {
    start: (rg: string, app: string): ReturnType<ContainerAppLifecycleClient["start"]> => ({
      pollUntilDone: async (): Promise<ContainerApp> => {
        if (overrides.startError) throw overrides.startError;
        calls.start.push(`${rg}/${app}`);
        return { name: app, location: "southeastasia" };
      },
    } as ReturnType<ContainerAppLifecycleClient["start"]>),
    stop: (rg: string, app: string): ReturnType<ContainerAppLifecycleClient["stop"]> => ({
      pollUntilDone: async (): Promise<ContainerApp> => {
        if (overrides.stopError) throw overrides.stopError;
        calls.stop.push(`${rg}/${app}`);
        return { name: app, location: "southeastasia" };
      },
    } as ReturnType<ContainerAppLifecycleClient["stop"]>),
  };

  const config: ConfigService = new ConfigService({
    AZURE_RG_NAME: "central-rg",
    AZURE_DEPLOYMENT_TIMEOUT_MS: "5000",
  });

  const provider: AzureContainerLifecycleManager = new AzureContainerLifecycleManager(config, clients);
  return { provider, calls };
}

test("AzureContainerLifecycleManager.startApp calls containerApps.start with correct resource group and app name", async (): Promise<void> => {
  const { provider, calls }: LifecycleFixture = createFixture();
  await provider.startApp("123", "my-app");
  assert.deepEqual(calls.start, ["user-rg-123/my-app"]);
  assert.deepEqual(calls.stop, []);
});

test("AzureContainerLifecycleManager.stopApp calls containerApps.stop with correct resource group and app name", async (): Promise<void> => {
  const { provider, calls }: LifecycleFixture = createFixture();
  await provider.stopApp("123", "my-app");
  assert.deepEqual(calls.stop, ["user-rg-123/my-app"]);
  assert.deepEqual(calls.start, []);
});

test("AzureContainerLifecycleManager.startApp wraps Azure errors in BuildProviderError", async (): Promise<void> => {
  const { provider }: LifecycleFixture = createFixture({
    startError: new Error("ARM start failed"),
  });
  await assert.rejects(
    provider.startApp("123", "my-app"),
    (err: unknown): boolean => err instanceof BuildProviderError && err.message.includes("Container App start failed"),
  );
});

test("AzureContainerLifecycleManager.stopApp wraps Azure errors in BuildProviderError", async (): Promise<void> => {
  const { provider }: LifecycleFixture = createFixture({
    stopError: new Error("ARM stop failed"),
  });
  await assert.rejects(
    provider.stopApp("123", "my-app"),
    (err: unknown): boolean => err instanceof BuildProviderError && err.message.includes("Container App stop failed"),
  );
});

test("lifecycle refuses invalid workload targets before calling Azure", async (): Promise<void> => {
  const { provider, calls }: LifecycleFixture = createFixture();
  const actions: readonly ("startApp" | "stopApp")[] = ["startApp", "stopApp"];
  for (let index: number = 0; index < actions.length; index++) {
    const action: "startApp" | "stopApp" = actions[index]!;
    await assert.rejects(provider[action]("../platform", "my-app"), BuildProviderError);
    await assert.rejects(provider[action]("123", "../other-app"), BuildProviderError);
  }
  assert.deepEqual(calls, { start: [], stop: [] });
  const blocked: AzureContainerLifecycleManager = new AzureContainerLifecycleManager(
    new ConfigService({ AZURE_PLATFORM_RESOURCE_GROUP: "USER-RG-123" }),
    { start: (): never => { throw new Error("Unexpected Azure access"); }, stop: (): never => { throw new Error("Unexpected Azure access"); } },
  );
  await assert.rejects(blocked.startApp("123", "my-app"), BuildProviderError);
  await assert.rejects(blocked.stopApp("123", "my-app"), BuildProviderError);
});
