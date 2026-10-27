import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { FeatureFlagConfiguration } from "../dist/feature-flags/provider.js";
import type { AzureCredential, HttpTransport } from "../dist/external-clients.js";
import { AzureDeploymentRegionsReader } from "../dist/azure/deployment-regions.js";
import { sharedEnvironmentReference } from "../dist/azure/shared-environment.js";

const SHARED_ID: string = "/subscriptions/sub/resourceGroups/shared-infra/providers/Microsoft.App/managedEnvironments/pool";
const CREDENTIAL: AzureCredential = { getToken: async (scope: string | string[]): Promise<{ token: string; expiresOnTimestamp: number }> => {
  assert.equal(scope, "https://management.azure.com/.default");
  return { token: "private-token", expiresOnTimestamp: Date.now() + 60_000 };
} };
const ENVIRONMENT: object = { id: SHARED_ID, location: "Japan East", properties: { provisioningState: "Succeeded",
  workloadProfiles: [{ name: "CustomConsumption", workloadProfileType: "Consumption" }] } };
const APP: object = { resourceTypes: [{ resourceType: "containerApps", locations: ["Japan East", "Southeast Asia"] }] };
const LOCATIONS: object = { value: [
  { name: "japaneast", displayName: "Japan East", type: "Region" },
  { name: "southeastasia", displayName: "Southeast Asia", type: "Region" },
  { name: "global", displayName: "Global", metadata: { regionType: "Logical" } },
] };

type Override = (url: URL) => Response | undefined;

function reader(override: Override = (): undefined => undefined, requests: string[] = [], flags: FeatureFlagConfiguration = { feature_flags: [] }): AzureDeploymentRegionsReader {
  const http: HttpTransport = async (input: Parameters<HttpTransport>[0], init?: RequestInit): Promise<Response> => {
    const url: URL = new URL(String(input));
    requests.push(url.href);
    assert.equal(url.origin, "https://management.azure.com");
    assert.ok(url.pathname.startsWith("/subscriptions/sub/"));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-token");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const response: Response | undefined = override(url);
    if (response) return response;
    if (url.pathname === SHARED_ID) return Response.json(ENVIRONMENT);
    if (url.pathname.endsWith("/Microsoft.App")) return Response.json(APP);
    if (url.pathname.endsWith("/sys.regionrestriction")) return new Response(null, { status: 404 });
    assert.equal(url.pathname, "/subscriptions/sub/locations", "No quota or VNet lookup should occur for a reused environment");
    return Response.json(LOCATIONS);
  };
  return new AzureDeploymentRegionsReader(new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_SHARED_ENVIRONMENT_NAME: "pool", AZURE_PLATFORM_RESOURCE_GROUP: "shared-infra" }), CREDENTIAL, http, flags, { list: async (): Promise<[]> => [] });
}

test("region catalog returns only the configured environment's live region without checking environment-count quotas", async (): Promise<void> => {
  const requests: string[] = [];
  assert.deepEqual(await reader(undefined, requests).list(), [{ name: "japaneast", displayName: "Japan East" }]);
  assert.equal(requests.length, 4);
  const changed: AzureDeploymentRegionsReader = reader((url: URL): Response | undefined => url.pathname === SHARED_ID
    ? Response.json({ ...ENVIRONMENT, location: "Southeast Asia" }) : undefined);
  assert.deepEqual(await changed.list(), [{ name: "southeastasia", displayName: "Southeast Asia" }]);
});

test("shared region is normalized, deduplicated, and filtered by advertised app support and current policy", async (): Promise<void> => {
  let policy: unknown = { properties: { parameters: { listOfAllowedLocations: { value: ["Japan East", "japaneast"] } } } };
  const adapter: AzureDeploymentRegionsReader = reader((url: URL): Response | undefined => {
    if (url.pathname.endsWith("/sys.regionrestriction")) return Response.json(policy);
    if (url.pathname.endsWith("/locations")) return Response.json({ value: [
      { name: "Japan East", displayName: "Japan East" }, { name: "japaneast", displayName: "Japan East" },
    ] });
    return undefined;
  });
  assert.deepEqual(await adapter.list(), [{ name: "japaneast", displayName: "Japan East" }]);
  policy = { properties: { parameters: { listOfAllowedLocations: { value: ["southeastasia"] } } } };
  assert.deepEqual(await adapter.list(), []);
  policy = { properties: { parameters: { listOfAllowedLocations: { value: [] } } } };
  assert.deepEqual(await adapter.list(), []);
  policy = { properties: { enforcementMode: "DoNotEnforce" } };
  assert.equal((await adapter.list()).length, 1);
  policy = { properties: {} };
  await assert.rejects(adapter.list(), /invalid allowed policy/);
  const unsupported: AzureDeploymentRegionsReader = reader((url: URL): Response | undefined => url.pathname.endsWith("/Microsoft.App")
    ? Response.json({ resourceTypes: [{ resourceType: "containerApps", locations: [] }] }) : undefined);
  assert.deepEqual(await unsupported.list(), []);
});

test("shared environment lookup fails closed on Azure failures, bad identities, readiness, modes, and profiles", async (): Promise<void> => {
  const statuses: number[] = [401, 403, 404, 429, 500];
  for (let index: number = 0; index < statuses.length; index++) {
    const adapter: AzureDeploymentRegionsReader = reader((url: URL): Response | undefined => url.pathname === SHARED_ID
      ? new Response(null, { status: statuses[index] }) : undefined);
    await assert.rejects(adapter.list(), new RegExp(`HTTP ${statuses[index]}`));
  }
  const malformed: unknown[] = [null, {}, { ...ENVIRONMENT, id: SHARED_ID.replace("/sub/", "/other/") },
    { ...ENVIRONMENT, location: "" }, { id: SHARED_ID, location: "japaneast", properties: { provisioningState: "Waiting" } },
    { id: SHARED_ID, location: "japaneast", properties: { provisioningState: "Succeeded", workloadProfiles: [] } },
    { id: SHARED_ID, location: "japaneast", properties: { provisioningState: "Succeeded", environmentMode: "Express" } },
  ];
  for (let index: number = 0; index < malformed.length; index++) {
    await assert.rejects(reader((url: URL): Response | undefined => url.pathname === SHARED_ID ? Response.json(malformed[index]) : undefined).list());
  }
});

test("subscription location pagination stays scoped and all metadata failures remain errors", async (): Promise<void> => {
  const paged: AzureDeploymentRegionsReader = reader((url: URL): Response | undefined => url.pathname.endsWith("/locations")
    ? Response.json(url.searchParams.has("page") ? LOCATIONS : { value: [], nextLink: `${url.href}&page=2` }) : undefined);
  assert.equal((await paged.list()).length, 1);
  const links: string[] = ["https://example.com/steal", "https://management.azure.com/subscriptions/other/locations?api-version=2022-12-01",
    "https://management.azure.com/subscriptions/sub/locations?api-version=2022-12-01"];
  for (let index: number = 0; index < links.length; index++) {
    await assert.rejects(reader((url: URL): Response | undefined => url.pathname.endsWith("/locations")
      ? Response.json({ value: [], nextLink: links[index] }) : undefined).list(), /invalid location pagination/);
  }
  const paths: string[] = ["/locations", "/Microsoft.App", "/sys.regionrestriction"];
  for (let index: number = 0; index < paths.length; index++) {
    await assert.rejects(reader((url: URL): Response | undefined => url.pathname.endsWith(paths[index]!) ? new Response(null, { status: 403 }) : undefined).list(), /HTTP 403/);
    await assert.rejects(reader((url: URL): Response | undefined => url.pathname.endsWith(paths[index]!) ? Response.json({}) : undefined).list());
  }
});

test("shared environment configuration rejects missing, malformed names and full resource IDs", (): void => {
  const invalid: (string | undefined)[] = [undefined, "", "https://evil.example/pool", SHARED_ID.replace("/sub/", "/other/"), `${SHARED_ID}?secret=1`];
  for (let index: number = 0; index < invalid.length; index++) {
    assert.throws((): void => { new AzureDeploymentRegionsReader(new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_SHARED_ENVIRONMENT_NAME: invalid[index], AZURE_PLATFORM_RESOURCE_GROUP: "shared-infra" }), CREDENTIAL, async (): Promise<Response> => Response.json({}), { feature_flags: [] }, { list: async (): Promise<[]> => [] }); });
  }
});

test("shared environment names use the configured platform group with the existing group fallback", (): void => {
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_SHARED_ENVIRONMENT_NAME: " pool ", AZURE_RG_NAME: "shared-infra" });
  assert.deepEqual(sharedEnvironmentReference(config), { id: SHARED_ID, resourceGroup: "shared-infra", name: "pool" });
  const preferred: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_SHARED_ENVIRONMENT_NAME: "pool", AZURE_RG_NAME: "shared-infra", AZURE_PLATFORM_RESOURCE_GROUP: "other-infra" });
  assert.equal(sharedEnvironmentReference(preferred).resourceGroup, "other-infra");
  const invalidGroups: string[] = ["", "group/path", "group?query", "group#fragment"];
  for (let index: number = 0; index < invalidGroups.length; index++) {
    const invalidConfig: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_SHARED_ENVIRONMENT_NAME: "pool", AZURE_PLATFORM_RESOURCE_GROUP: invalidGroups[index], AZURE_RG_NAME: "" });
    assert.throws((): void => { sharedEnvironmentReference(invalidConfig); }, /platform resource group/);
  }
});


test("region discovery reevaluates the current feature flag after refresh", async (): Promise<void> => {
  let enabled: boolean = false;
  const flags: FeatureFlagConfiguration = { get feature_flags(): readonly unknown[] { return [{ id: "LegacyPerUserProvisioning", enabled }]; } };
  const adapter: AzureDeploymentRegionsReader = reader(undefined, [], flags);
  assert.equal((await adapter.list()).length, 1);
  enabled = true;
  assert.deepEqual(await adapter.list(), []);
  enabled = false;
  assert.equal((await adapter.list()).length, 1);
});
