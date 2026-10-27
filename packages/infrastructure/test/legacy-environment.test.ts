import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ManagedEnvironment } from "@azure/arm-appcontainers";
import type { VirtualNetwork } from "@azure/arm-network";
import { legacyProvisioningEnabled } from "../dist/feature-flags/legacy-provisioning.js";
import { AzureLegacyEnvironmentProvisioner, type LegacyEnvironmentClients } from "../dist/azure/legacy-environment.js";

const ENV_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/managedEnvironments/user-aca-env-123";
const VNET_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.Network/virtualNetworks/user-vnet-123";
const SUBNET_ID: string = `${VNET_ID}/subnets/aca-infrastructure`;

function fixture(options: { enabled?: boolean; group?: boolean; network?: VirtualNetwork; networkError?: unknown; environment?: ManagedEnvironment; noDefault?: boolean } = {}): {
  provider: AzureLegacyEnvironmentProvisioner; events: string[];
} {
  const events: string[] = [];
  const clients: LegacyEnvironmentClients = {
    resourceGroups: {
      checkExistence: async (): Promise<{ body: boolean }> => { events.push("rg-check"); return { body: options.group ?? false }; },
      get: async (): Promise<{ location: string }> => { events.push("rg-get"); return { location: "West Europe" }; },
      createOrUpdate: async (name: string, input: { location: string }): Promise<{ location: string }> => {
        assert.equal(name, "user-rg-123");
        assert.equal(input.location, "westeurope");
        events.push("rg-create");
        return input;
      },
    },
    managedEnvironments: {
      get: async (group: string, name: string): Promise<ManagedEnvironment> => {
        assert.equal(group, "user-rg-123"); assert.equal(name, "user-aca-env-123"); events.push("env-get");
        if (!options.environment) throw { statusCode: 404 };
        return options.environment;
      },
      createOrUpdate: (group: string, name: string, input: ManagedEnvironment): ReturnType<LegacyEnvironmentClients["managedEnvironments"]["createOrUpdate"]> => {
        assert.equal(group, "user-rg-123"); assert.equal(name, "user-aca-env-123");
        assert.equal(input.location, "westeurope");
        assert.equal(input.environmentMode, "WorkloadProfiles");
        assert.deepEqual(input.workloadProfiles, [{ name: "Consumption", workloadProfileType: "Consumption" }]);
        assert.deepEqual(input.vnetConfiguration, { infrastructureSubnetId: SUBNET_ID, internal: false });
        events.push("env-create");
        return { pollUntilDone: async (): Promise<ManagedEnvironment> => {
          events.push("env-ready"); return { ...input, id: ENV_ID, provisioningState: "Succeeded" };
        } } as ReturnType<LegacyEnvironmentClients["managedEnvironments"]["createOrUpdate"]>;
      },
    },
    virtualNetworks: {
      get: async (): Promise<VirtualNetwork> => {
        events.push("vnet-get");
        if (options.networkError) throw options.networkError;
        if (!options.network) throw { statusCode: 404 };
        return options.network;
      },
      createOrUpdate: (group: string, name: string, input: VirtualNetwork): ReturnType<LegacyEnvironmentClients["virtualNetworks"]["createOrUpdate"]> => {
        assert.equal(group, "user-rg-123"); assert.equal(name, "user-vnet-123");
        assert.equal(input.location, "westeurope");
        assert.deepEqual(input.addressSpace, { addressPrefixes: ["10.0.0.0/16"] });
        assert.deepEqual(input.subnets, [{ name: "aca-infrastructure", addressPrefix: "10.0.0.0/24", delegations: [{ name: "container-apps", serviceName: "Microsoft.App/environments" }] }]);
        events.push("vnet-create");
        return { pollUntilDone: async (): Promise<VirtualNetwork> => {
          events.push("vnet-ready"); return { ...input, id: VNET_ID, provisioningState: "Succeeded", subnets: [{ ...input.subnets![0], id: SUBNET_ID, provisioningState: "Succeeded" }] };
        } } as ReturnType<LegacyEnvironmentClients["virtualNetworks"]["createOrUpdate"]>;
      },
    },
  };
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform",
    AZURE_LEGACY_DEFAULT_REGION: options.noDefault ? undefined : "westeurope", AZURE_DEPLOYMENT_POLL_INTERVAL_MS: "1" });
  return { provider: new AzureLegacyEnvironmentProvisioner(config, clients, { feature_flags: [{ id: "LegacyPerUserProvisioning", enabled: options.enabled ?? false }] }), events };
}

test("legacy provisioning defaults off and rejects accidental direct invocation without Azure calls", async (): Promise<void> => {
  assert.equal(legacyProvisioningEnabled({ feature_flags: [] }), false);
  assert.equal(legacyProvisioningEnabled({ feature_flags: [{ id: "LegacyPerUserProvisioning", enabled: false }] }), false);
  assert.equal(legacyProvisioningEnabled({ feature_flags: [{ id: "LegacyPerUserProvisioning", enabled: true }] }), true);
  const setup: ReturnType<typeof fixture> = fixture();
  await assert.rejects(setup.provider.getAcaEnvironment({ userId: "123" }), /disabled/);
  assert.deepEqual(setup.events, []);
});

test("explicit opt-in preserves RG, delegated subnet, VNet and Workload Profiles environment creation order", async (): Promise<void> => {
  const setup: ReturnType<typeof fixture> = fixture({ enabled: true });
  const environment: ManagedEnvironment = await setup.provider.getAcaEnvironment({ userId: "123" });
  assert.equal(environment.id, ENV_ID);
  assert.deepEqual(setup.events, ["rg-check", "rg-create", "env-get", "vnet-get", "vnet-create", "vnet-ready", "env-create", "env-ready"]);
});

test("legacy environment reuse preserves resources and redeployment never recreates a missing environment", async (): Promise<void> => {
  const existing: ManagedEnvironment = { id: ENV_ID, location: "West Europe", provisioningState: "Succeeded" };
  const setup: ReturnType<typeof fixture> = fixture({ enabled: true, group: true, environment: existing });
  assert.strictEqual(await setup.provider.getAcaEnvironment({ userId: "123", requireExisting: true }), existing);
  assert.deepEqual(setup.events, ["rg-get", "env-get"]);
  const missing: ReturnType<typeof fixture> = fixture({ enabled: true, group: true });
  await assert.rejects(missing.provider.getAcaEnvironment({ userId: "123", requireExisting: true }), /existing managed environment is missing/);
  assert.deepEqual(missing.events, ["rg-get", "env-get"]);
});

test("legacy networking failures and incompatible subnets do not overwrite existing resources", async (): Promise<void> => {
  const forbidden: ReturnType<typeof fixture> = fixture({ enabled: true, networkError: { statusCode: 403 } });
  await assert.rejects(forbidden.provider.getAcaEnvironment({ userId: "123" }), /Virtual network lookup failed/);
  assert.equal(forbidden.events.includes("vnet-create"), false);
  const incompatible: ReturnType<typeof fixture> = fixture({ enabled: true, network: { id: VNET_ID, location: "westeurope", provisioningState: "Succeeded", subnets: [] } });
  await assert.rejects(incompatible.provider.getAcaEnvironment({ userId: "123" }), /ready dedicated aca-infrastructure subnet/);
  assert.equal(incompatible.events.includes("vnet-create"), false);
  assert.equal(incompatible.events.includes("env-create"), false);
});

test("legacy default region requires explicit configuration rather than a fixed location", async (): Promise<void> => {
  const setup: ReturnType<typeof fixture> = fixture({ enabled: true, noDefault: true });
  await assert.rejects(setup.provider.getAcaEnvironment({ userId: "123" }), /AZURE_LEGACY_DEFAULT_REGION/);
  assert.equal(setup.events.includes("rg-create"), false);
  assert.equal((await setup.provider.getAcaEnvironment({ userId: "123", region: "westeurope" })).location, "westeurope");
});
