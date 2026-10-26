import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { AzureCredential, HttpTransport } from "../dist/external-clients.js";
import { AzureDeploymentRegionsReader } from "../dist/azure/deployment-regions.js";

const CREDENTIAL: AzureCredential = { getToken: async (scope: string | string[]): Promise<{ token: string; expiresOnTimestamp: number }> => {
  assert.equal(scope, "https://management.azure.com/.default");
  return { token: "private-token", expiresOnTimestamp: Date.now() + 60_000 };
} };
const APP: object = { resourceTypes: [
  { resourceType: "containerApps", locations: ["Japan East", "Southeast Asia", "West US", "East US"] },
  { resourceType: "managedEnvironments", locations: ["Japan East", "Southeast Asia", "East US"] },
] };
const NETWORK: object = { resourceTypes: [{ resourceType: "virtualNetworks", locations: ["Japan East", "Southeast Asia", "West US"] }] };

function reader(http: HttpTransport): AzureDeploymentRegionsReader {
  return new AzureDeploymentRegionsReader(new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub" }), CREDENTIAL, http);
}

test("region discovery pages subscription locations and intersects all required resource types", async (): Promise<void> => {
  const requests: string[] = [];
  const adapter: AzureDeploymentRegionsReader = reader(async (input: Parameters<HttpTransport>[0], init?: RequestInit): Promise<Response> => {
    const url: URL = new URL(String(input));
    requests.push(url.href);
    assert.ok(url.pathname.startsWith("/subscriptions/sub/"));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-token");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (url.pathname.endsWith("/Microsoft.App")) return Response.json(APP);
    if (url.pathname.endsWith("/Microsoft.Network")) return Response.json(NETWORK);
    if (url.pathname.endsWith("/sys.regionrestriction")) return new Response(null, { status: 404 });
    if (url.searchParams.has("page")) return Response.json({ value: [
      { name: "Japan East", displayName: "Japan East", type: "Region" },
      { name: "westus", displayName: "West US", type: "Region" },
      { name: "eastus", displayName: "East US", type: "Region" },
      { name: "global", displayName: "Global", metadata: { regionType: "Logical" } },
    ] });
    return Response.json({ value: [
      { name: "southeastasia", displayName: "Southeast Asia", type: "Region" },
      { name: "japaneast", displayName: "Japan East", type: "Region" },
      { name: "edge", displayName: "Edge", type: "EdgeZone" },
    ], nextLink: "https://management.azure.com/subscriptions/sub/locations?api-version=2022-12-01&page=2" });
  });
  assert.deepEqual(await adapter.list(), [{ name: "japaneast", displayName: "Japan East" }, { name: "southeastasia", displayName: "Southeast Asia" }]);
  assert.equal(requests.length, 5);
});

test("region lookup returns an empty intersection but rejects unavailable or malformed Azure responses", async (): Promise<void> => {
  let bad: unknown = { value: [] };
  let status: number = 200;
  const adapter: AzureDeploymentRegionsReader = reader(async (input: Parameters<HttpTransport>[0]): Promise<Response> => {
    const url: URL = new URL(String(input));
    if (url.pathname.endsWith("/Microsoft.App")) return Response.json(APP);
    if (url.pathname.endsWith("/Microsoft.Network")) return Response.json(NETWORK);
    if (url.pathname.endsWith("/sys.regionrestriction")) return new Response(null, { status: 404 });
    return status === 200 ? Response.json(bad) : new Response("private upstream response", { status });
  });
  assert.deepEqual(await adapter.list(), []);
  bad = { value: [{ name: 123 }] };
  await assert.rejects(adapter.list(), /invalid subscription location/);
  status = 403;
  await assert.rejects(adapter.list(), /HTTP 403/);
  status = 429;
  await assert.rejects(adapter.list(), /HTTP 429/);
  const malformed: AzureDeploymentRegionsReader = reader(async (): Promise<Response> => Response.json({}));
  await assert.rejects(malformed.list());
});

test("location pagination cannot send ARM credentials outside the configured subscription or loop forever", async (): Promise<void> => {
  const links: string[] = ["https://example.com/steal", "https://management.azure.com/subscriptions/other/locations?api-version=2022-12-01",
    "https://management.azure.com/subscriptions/sub/locations?api-version=2022-12-01"];
  for (let index: number = 0; index < links.length; index++) {
    let locationReads: number = 0;
    const adapter: AzureDeploymentRegionsReader = reader(async (input: Parameters<HttpTransport>[0]): Promise<Response> => {
      const url: URL = new URL(String(input));
      assert.equal(url.origin, "https://management.azure.com");
      assert.ok(url.pathname.startsWith("/subscriptions/sub/"));
      if (url.pathname.endsWith("/Microsoft.App")) return Response.json(APP);
      if (url.pathname.endsWith("/Microsoft.Network")) return Response.json(NETWORK);
      if (url.pathname.endsWith("/sys.regionrestriction")) return new Response(null, { status: 404 });
      locationReads++;
      return Response.json({ value: [], nextLink: links[index] });
    });
    await assert.rejects(adapter.list(), /invalid location pagination/);
    assert.equal(locationReads, 1);
  }
});


test("system region policy filters supported locations using live normalized parameters", async (): Promise<void> => {
  let policy: unknown = { properties: { parameters: { listOfAllowedLocations: { value: ["Japan East", "japaneast", "westus"] } } } };
  let status: number = 200;
  const adapter: AzureDeploymentRegionsReader = reader(async (input: Parameters<HttpTransport>[0]): Promise<Response> => {
    const url: URL = new URL(String(input));
    if (url.pathname.endsWith("/Microsoft.App")) return Response.json(APP);
    if (url.pathname.endsWith("/Microsoft.Network")) return Response.json(NETWORK);
    if (url.pathname.endsWith("/sys.regionrestriction")) {
      assert.equal(url.searchParams.get("api-version"), "2023-04-01");
      return status === 200 ? Response.json(policy) : new Response(null, { status });
    }
    return Response.json({ value: [
      { name: "japaneast", displayName: "Japan East" },
      { name: "southeastasia", displayName: "Southeast Asia" },
      { name: "westus", displayName: "West US" },
    ] });
  });
  assert.deepEqual(await adapter.list(), [{ name: "japaneast", displayName: "Japan East" }]);
  policy = { properties: { parameters: { listOfAllowedLocations: { value: ["southeastasia"] } } } };
  assert.deepEqual(await adapter.list(), [{ name: "southeastasia", displayName: "Southeast Asia" }]);
  policy = { properties: { parameters: { listOfAllowedLocations: { value: [] } } } };
  assert.deepEqual(await adapter.list(), []);
  policy = { properties: { enforcementMode: "DoNotEnforce" } };
  assert.equal((await adapter.list()).length, 2);
  status = 404;
  assert.equal((await adapter.list()).length, 2);
  const failures: number[] = [401, 403, 429, 500];
  for (let index: number = 0; index < failures.length; index++) {
    status = failures[index];
    await assert.rejects(adapter.list(), new RegExp(`HTTP ${status}`));
  }
  status = 200;
  const malformed: unknown[] = [null, {}, { properties: {} },
    { properties: { enforcementMode: "invalid" } },
    { properties: { parameters: { listOfAllowedLocations: { value: [123] } } } },
    { properties: { parameters: { listOfAllowedLocations: { value: [" "] } } } },
    { properties: { parameters: { listOfAllowedLocations: { value: "japaneast" } } } }];
  for (let index: number = 0; index < malformed.length; index++) {
    policy = malformed[index];
    await assert.rejects(adapter.list(), /invalid.*policy/);
  }
});
