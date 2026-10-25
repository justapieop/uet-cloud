import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpHeaders, createPipelineRequest, type PipelinePolicy, type PipelineRequest, type PipelineResponse } from "@azure/core-rest-pipeline";
import { configurationDiagnosticCredential, configurationDiagnosticsPolicy, type ConfigurationDiagnostic } from "../dist/config/diagnostics.js";
import type { AzureCredential } from "../dist/external-clients.js";

test("configuration policy reports forbidden/network metadata without leaking request, headers or response values", async (): Promise<void> => {
  const events: ConfigurationDiagnostic[] = [];
  const policy: PipelinePolicy = configurationDiagnosticsPolicy("app-configuration", (event: ConfigurationDiagnostic): void => { events.push(event); });
  const request: PipelineRequest = createPipelineRequest({ url: "https://store.azconfig.io/kv/private-key", headers: createHttpHeaders({ authorization: "Bearer secret-token" }) });
  const response: PipelineResponse = { request, status: 403, headers: createHttpHeaders({ "x-ms-request-id": "11111111-2222-3333-4444-555555555555", "secret-header": "hidden" }),
    bodyAsText: JSON.stringify({ type: "https://azconfig.io/errors/ip-address-rejected", secret: "private-value" }) };
  assert.equal(await policy.sendRequest(request, async (): Promise<PipelineResponse> => response), response);
  assert.deepEqual(events, [{ dependency: "app-configuration", event: "http-failure", statusCode: 403, requestId: "11111111-2222-3333-4444-555555555555", category: "ip-address-rejected" }]);
  assert.doesNotMatch(JSON.stringify(events), /secret-token|private-key|private-value|hidden|azconfig.io/);
  response.status = 200;
  await policy.sendRequest(request, async (): Promise<PipelineResponse> => response);
  assert.equal(events.length, 1, "Successful configuration responses are never logged");
});

test("configuration diagnostics preserve network failures and never log arbitrary exception messages", async (): Promise<void> => {
  const events: ConfigurationDiagnostic[] = [];
  const policy: PipelinePolicy = configurationDiagnosticsPolicy("key-vault", (event: ConfigurationDiagnostic): void => { events.push(event); });
  const request: PipelineRequest = createPipelineRequest({ url: "https://vault.vault.azure.net/secrets/private" });
  const error: Error = Object.assign(new Error("secret exception contents"), { code: "ENOTFOUND" });
  await assert.rejects(policy.sendRequest(request, async (): Promise<never> => { throw error; }), (caught: unknown): boolean => caught === error);
  assert.deepEqual(events, [{ dependency: "key-vault", event: "request-failure", code: "ENOTFOUND", statusCode: undefined }]);
  assert.doesNotMatch(JSON.stringify(events), /secret|vault.azure.net/);
});

test("configuration credential reports only GUID identity claims once and forwards the original token and options", async (): Promise<void> => {
  const events: ConfigurationDiagnostic[] = [];
  const principalId: string = "11111111-2222-3333-4444-555555555555";
  const tenantId: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const token: string = `header.${Buffer.from(JSON.stringify({ oid: principalId, tid: tenantId, secret: "private-value" })).toString("base64url")}.signature`;
  const access: { token: string; expiresOnTimestamp: number } = { token, expiresOnTimestamp: Date.now() + 60_000 };
  const controller: AbortController = new AbortController();
  const credential: AzureCredential = configurationDiagnosticCredential({ getToken: async (...args: Parameters<AzureCredential["getToken"]>): ReturnType<AzureCredential["getToken"]> => {
    assert.equal(args[0], "scope"); assert.equal(args[1]?.abortSignal, controller.signal); return access;
  } }, (event: ConfigurationDiagnostic): void => { events.push(event); });
  assert.equal(await credential.getToken("scope", { abortSignal: controller.signal }), access);
  await credential.getToken("scope", { abortSignal: controller.signal });
  assert.deepEqual(events, [{ dependency: "azure-identity", event: "credential-selected", principalId, tenantId }]);
  assert.doesNotMatch(JSON.stringify(events), /private-value|signature|header/);
});

test("opaque tokens and logging failures cannot break configuration authentication", async (): Promise<void> => {
  const access: { token: string; expiresOnTimestamp: number } = { token: "opaque-token", expiresOnTimestamp: 1000 };
  const credential: AzureCredential = configurationDiagnosticCredential({ getToken: async (): ReturnType<AzureCredential["getToken"]> => access }, (): never => { throw new Error("Log sink failed"); });
  assert.equal(await credential.getToken("scope"), access);
  const error: Error = Object.assign(new Error("secret credential response"), { name: "AggregateAuthenticationError" });
  const events: ConfigurationDiagnostic[] = [];
  const failed: AzureCredential = configurationDiagnosticCredential({ getToken: async (): Promise<never> => { throw error; } }, (event: ConfigurationDiagnostic): void => { events.push(event); });
  await assert.rejects(failed.getToken("scope"), (caught: unknown): boolean => caught === error);
  assert.deepEqual(events, [{ dependency: "azure-identity", event: "credential-failure", code: "AggregateAuthenticationError" }]);
});
