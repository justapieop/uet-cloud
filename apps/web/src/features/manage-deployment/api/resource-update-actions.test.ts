import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire, registerHooks, type ResolveHookSync } from "node:module";
import { beforeEach, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ComputeConfiguration } from "../../../entities/deployment/model/compute-configuration.ts";
import type { ResourceUpdate } from "../model/deployment-spec.ts";

const require: NodeJS.Require = createRequire(import.meta.url);
const headersUrl: string = pathToFileURL(require.resolve("next/headers")).href;
const cacheUrl: string = pathToFileURL(require.resolve("next/cache")).href;
const clientUrl: string = new URL("../../../shared/api/server.ts", import.meta.url).href;
const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
  const aliases: Record<string, string> = {
    "@/entities/deployment": new URL("../../../entities/deployment/model/compute-configuration.ts", import.meta.url).href,
    "@/shared/api/server": clientUrl, "next/headers": headersUrl, "next/cache": cacheUrl,
  };
  if (aliases[specifier]) return { url: aliases[specifier]!, shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL && existsSync(new URL(`${specifier}.ts`, context.parentURL))) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
};
registerHooks({ resolve });
interface Reply { response: Response; data?: unknown; error?: unknown }
interface Call { route: string; options: Record<string, unknown> }
const ID: string = "abcdef01-1234-4567-89ab-abcdef012345";
const OPERATION: string = "abcdef02-1234-4567-89ab-abcdef012345";
const CONFIG: ComputeConfiguration = { max_vcpu: 0.5, max_memory: 1, min_scaling: 0, max_scaling: 2 };
let cookie: string | null = "connect.sid=fixture";
let reply: Reply = { response: new Response(null, { status: 202 }) };
let transportFailure: boolean = false;
const patches: Call[] = [];
const gets: Call[] = [];
const revalidated: string[] = [];
mock.module(headersUrl, { namedExports: { headers: async (): Promise<Headers> => new Headers(cookie ? { cookie } : {}) } });
mock.module(cacheUrl, { namedExports: { revalidatePath: (path: string): void => { revalidated.push(path); } } });
mock.module(clientUrl, { namedExports: { apiClient: {
  PATCH: async (route: string, options: Record<string, unknown>): Promise<Reply> => { patches.push({ route, options }); if (transportFailure) throw new Error("private transport error"); return reply; },
  GET: async (route: string, options: Record<string, unknown>): Promise<Reply> => { gets.push({ route, options }); if (transportFailure) throw new Error("private transport error"); return reply; },
} } });
const update: typeof import("./update-deployment-spec.ts") = await import("./update-deployment-spec.ts");
const query: typeof import("./get-deployment-resource-update.ts") = await import("./get-deployment-resource-update.ts");

function operation(overrides: Partial<ResourceUpdate> = {}): ResourceUpdate {
  return { operation_id: OPERATION, deployment_id: ID, status: "APPLYING", requested: CONFIG, observed: null, no_op: null,
    target_revision: "app--target", error_code: null, error_message: null, created_at: "2026-11-08T00:00:00Z", started_at: null, completed_at: null, ...overrides };
}
beforeEach((): void => {
  cookie = "connect.sid=fixture"; transportFailure = false; patches.length = 0; gets.length = 0; revalidated.length = 0;
  reply = { response: new Response(null, { status: 202 }), data: { operation_id: OPERATION, deployment_id: ID, status: "PENDING", requested: CONFIG } };
});

test("save submits only compute, exact version/key and the session, and waits for a valid 202 receipt", async (): Promise<void> => {
  const result: Awaited<ReturnType<typeof update.updateDeploymentSpec>> = await update.updateDeploymentSpec(ID, CONFIG, "v1", "same-key");
  assert.equal(result.kind, "accepted");
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.route, "/deployments/{id}");
  assert.deepEqual(patches[0]?.options.body, CONFIG);
  assert.deepEqual(patches[0]?.options.params, { path: { id: ID }, header: { "If-Match": "v1", "Idempotency-Key": "same-key" } });
  assert.deepEqual(patches[0]?.options.headers, { cookie });
  assert.equal(patches[0]?.options.cache, "no-store");
  assert.deepEqual(revalidated, []);
});

test("save rejects invalid inputs and missing session before any backend mutation", async (): Promise<void> => {
  const invalid: Array<[string, ComputeConfiguration, string, string, number]> = [
    ["bad-id", CONFIG, "v1", "key", 400], [ID, { ...CONFIG, max_memory: 4 }, "v1", "key", 400],
    [ID, CONFIG, "*", "key", 428], [ID, CONFIG, "W/v1", "key", 428], [ID, CONFIG, "v1,v2", "key", 428],
    [ID, CONFIG, "", "key", 428], [ID, CONFIG, "v1", "", 400], [ID, CONFIG, "v1", "bad\nkey", 400],
  ];
  for (let index: number = 0; index < invalid.length; index++) {
    const item: [string, ComputeConfiguration, string, string, number] = invalid[index]!;
    const result: Awaited<ReturnType<typeof update.updateDeploymentSpec>> = await update.updateDeploymentSpec(item[0], item[1], item[2], item[3]);
    assert.equal(result.kind, "error"); if (result.kind === "error") assert.equal(result.status, item[4]);
  }
  cookie = null;
  assert.equal((await update.updateDeploymentSpec(ID, CONFIG, "v1", "key")).kind, "error");
  assert.equal(patches.length, 0);
});

test("wrong owner, wrong requested resources, invalid operation ID and non-202 success cannot confirm acceptance", async (): Promise<void> => {
  const invalid: unknown[] = [undefined, { operation_id: "bad", deployment_id: ID, status: "PENDING", requested: CONFIG },
    { operation_id: OPERATION, deployment_id: "foreign", status: "PENDING", requested: CONFIG },
    { operation_id: OPERATION, deployment_id: ID, status: "PENDING", requested: { ...CONFIG, max_scaling: 5 } }];
  for (let index: number = 0; index < invalid.length; index++) {
    reply = { response: new Response(null, { status: 202 }), data: invalid[index] };
    const result: Awaited<ReturnType<typeof update.updateDeploymentSpec>> = await update.updateDeploymentSpec(ID, CONFIG, "v1", "key");
    assert.equal(result.kind, "error"); if (result.kind === "error") assert.equal(result.outcomeUnknown, true);
  }
  reply.response = new Response(null, { status: 200 });
  assert.equal((await update.updateDeploymentSpec(ID, CONFIG, "v1", "key")).kind, "error");
});

test("a lost response or 503 preserves uncertainty so the original request can be replayed", async (): Promise<void> => {
  transportFailure = true;
  const lost: Awaited<ReturnType<typeof update.updateDeploymentSpec>> = await update.updateDeploymentSpec(ID, CONFIG, "v1", "key");
  assert.equal(lost.kind, "error"); if (lost.kind === "error") assert.equal(lost.outcomeUnknown, true);
  transportFailure = false; reply = { response: new Response(null, { status: 503 }), error: { message: "private" } };
  const unavailable: Awaited<ReturnType<typeof update.updateDeploymentSpec>> = await update.updateDeploymentSpec(ID, CONFIG, "v1", "key");
  assert.equal(unavailable.kind, "error"); if (unavailable.kind === "error") assert.equal(unavailable.outcomeUnknown, true);
});

test("status polling checks operation ownership, disables cache and does not revalidate an active update", async (): Promise<void> => {
  reply = { response: new Response(null, { status: 200 }), data: operation() };
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "ready");
  assert.equal(gets[0]?.options.cache, "no-store");
  assert.deepEqual(gets[0]?.options.headers, { cookie, "Cache-Control": "no-cache" });
  assert.deepEqual(revalidated, []);
  reply.data = operation({ operation_id: ID });
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "error");
  reply.data = operation({ deployment_id: OPERATION });
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "error");
});

test("a succeeded response needs observed resources matching the requested configuration", async (): Promise<void> => {
  reply = { response: new Response(null, { status: 200 }), data: operation({ status: "SUCCEEDED", observed: null }) };
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "error");
  reply.data = operation({ status: "SUCCEEDED", observed: { ...CONFIG, max_scaling: 4 } });
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "error");
  assert.deepEqual(revalidated, []);
});

test("verified success and definitive failure refresh applied values, including a failed rollout without observed data", async (): Promise<void> => {
  reply = { response: new Response(null, { status: 200 }), data: operation({ status: "SUCCEEDED", observed: CONFIG }) };
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "ready");
  assert.deepEqual(revalidated, ["/dashboard", `/dashboard/deployments/${ID}`]);
  revalidated.length = 0;
  reply.data = operation({ status: "FAILED", observed: null, error_code: "RESOURCE_REVISION_FAILED" });
  assert.equal((await query.getDeploymentResourceUpdate(ID, OPERATION)).kind, "ready");
  assert.equal(revalidated.length, 2);
});

test("a receipt with canonical lowercase UUIDs confirms an uppercase UUID request", async (): Promise<void> => {
  assert.equal((await update.updateDeploymentSpec(ID.toUpperCase(), CONFIG, "v1", "key")).kind, "accepted");
});

test("status polling accepts canonical UUIDs after restoring an uppercase operation ID", async (): Promise<void> => {
  reply = { response: new Response(null, { status: 200 }), data: operation() };
  assert.equal((await query.getDeploymentResourceUpdate(ID.toUpperCase(), OPERATION.toUpperCase())).kind, "ready");
});
