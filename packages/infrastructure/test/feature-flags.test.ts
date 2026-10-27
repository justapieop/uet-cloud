import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AzureAppConfiguration } from "@azure/app-configuration-provider";
import { FEATURE_FLAG_REFRESH_INTERVAL_MS, FeatureFlagsService, legacyProvisioningEnabled, LEGACY_PROVISIONING_FLAG } from "../dist/feature-flags/index.js";

test("feature flags refresh after 12 hours and stop polling on shutdown", async (context: TestContext): Promise<void> => {
  const initialFlags: ReadonlyArray<unknown> = [{ id: "before", enabled: false }];
  const updatedFlags: ReadonlyArray<unknown> = [{ id: "after", enabled: true }];
  let flags: ReadonlyArray<unknown> = initialFlags;
  let refreshCalls: number = 0;
  const configuration: AzureAppConfiguration = {
    get: (key: string): unknown => key === "feature_management" ? { feature_flags: flags } : undefined,
    refresh: async (): Promise<void> => {
      refreshCalls++;
      flags = updatedFlags;
    },
  } as unknown as AzureAppConfiguration;
  const service: FeatureFlagsService = new FeatureFlagsService(configuration);

  assert.deepEqual(service.feature_flags, initialFlags);
  context.mock.timers.enable({ apis: ["setInterval"], now: 0 });

  try {
    service.onModuleInit();
    context.mock.timers.tick(FEATURE_FLAG_REFRESH_INTERVAL_MS - 1);
    assert.equal(refreshCalls, 0);

    context.mock.timers.tick(1);
    await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); });
    assert.equal(refreshCalls, 1);
    assert.deepEqual(service.feature_flags, updatedFlags);

    service.onModuleDestroy();
    context.mock.timers.tick(FEATURE_FLAG_REFRESH_INTERVAL_MS);
    assert.equal(refreshCalls, 1);
  } finally {
    service.onModuleDestroy();
  }
});

test("a failed refresh retains the last known flags", async (): Promise<void> => {
  const initialFlags: ReadonlyArray<unknown> = [{ id: "stable", enabled: true }];
  const configuration: AzureAppConfiguration = {
    get: (key: string): unknown => key === "feature_management" ? { feature_flags: initialFlags } : undefined,
    refresh: async (): Promise<void> => {
      throw new Error("Temporary Azure failure");
    },
  } as unknown as AzureAppConfiguration;
  const service: FeatureFlagsService = new FeatureFlagsService(configuration);

  await assert.rejects(service.refresh(), /Temporary Azure failure/);
  assert.deepEqual(service.feature_flags, initialFlags);
});


test("legacy provisioning is an unconditional, disabled-by-default feature flag", (): void => {
  assert.equal(legacyProvisioningEnabled(new FeatureFlagsService(null)), false);
  const disabled: unknown[][] = [[], [{ id: LEGACY_PROVISIONING_FLAG, enabled: false }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: "true" }], [{ id: LEGACY_PROVISIONING_FLAG }],
    [{ id: "unrelated", enabled: true }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: true }, { id: LEGACY_PROVISIONING_FLAG, enabled: false }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: true, conditions: null }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: true, conditions: { requirement_type: "All", client_filters: [] } }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: true, conditions: { client_filters: [{ name: "Microsoft.Percentage", parameters: { Value: 100 } }] } }],
    [{ id: LEGACY_PROVISIONING_FLAG, enabled: true, variants: [] }],
  ];
  for (let index: number = 0; index < disabled.length; index++) {
    assert.equal(legacyProvisioningEnabled({ feature_flags: disabled[index]! }), false);
  }
  assert.equal(legacyProvisioningEnabled({ feature_flags: [{ id: LEGACY_PROVISIONING_FLAG, enabled: true }] }), true);
  assert.equal(legacyProvisioningEnabled({ feature_flags: [{ id: LEGACY_PROVISIONING_FLAG, enabled: true, conditions: { client_filters: [] } }] }), true);
});

test("legacy provisioning observes refreshed Azure flag snapshots and retains the last snapshot on refresh failure", async (): Promise<void> => {
  let enabled: boolean = false;
  let failure: boolean = false;
  const configuration: AzureAppConfiguration = {
    get: (): unknown => ({ feature_flags: [{ id: LEGACY_PROVISIONING_FLAG, enabled }] }),
    refresh: async (): Promise<void> => { if (failure) throw new Error("Azure unavailable"); enabled = !enabled; },
  } as unknown as AzureAppConfiguration;
  const service: FeatureFlagsService = new FeatureFlagsService(configuration);
  assert.equal(legacyProvisioningEnabled(service), false);
  await service.refresh();
  assert.equal(legacyProvisioningEnabled(service), true);
  failure = true;
  await assert.rejects(service.refresh(), /Azure unavailable/);
  assert.equal(legacyProvisioningEnabled(service), true);
  failure = false;
  await service.refresh();
  assert.equal(legacyProvisioningEnabled(service), false);
});
