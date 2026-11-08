import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { IdempotencyModule } from "@nestjs/idempotency";
import { CheckPermissionsCase, GetDeploymentResourceUpdateCase, UpdateDeploymentResourcesCase } from "../../application/dist/index.js";
import { Permission, Plan, Role, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { DeploymentResourcesController } from "../dist/controllers/DeploymentResources.controller.js";
import { PLAN } from "../../application/test/support/admission.ts";
import { ResourceAdmissionFixture, ID, REQUESTED, BASELINE } from "../../application/test/support/resource-updates.ts";

const BODY: Readonly<Record<string, number>> = { max_vcpu: REQUESTED.maxVcpu, max_memory: REQUESTED.maxMemory, min_scaling: REQUESTED.minScaling, max_scaling: REQUESTED.maxScaling };
const VERSION: string = `"${BASELINE.version}"`;
interface Session { roles: Role[]; authenticated: boolean; suspended: boolean }
interface HTTPFixture {
  readonly setup: ResourceAdmissionFixture; readonly state: Session;
  readonly patch: (key?: string, body?: unknown, version?: string | null, id?: string) => Promise<globalThis.Response>;
  readonly get: (operationId: string) => Promise<globalThis.Response>;
}
function roles(): Role[] {
  return [new Role({ id: "updater", name: "Updater", permission: (1n << BigInt(Permission.DeploymentUpdate.offset)) | (1n << BigInt(Permission.DeploymentRead.offset)) })];
}
async function fixture(context: TestContext): Promise<HTTPFixture> {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  setup.plans = [new Plan({ ...PLAN, vcpu: 2, memory: 4, maxReplicas: 5 })];
  const state: Session = { roles: roles(), authenticated: true, suspended: false };
  class FixtureModule {}
  Module({ imports: [IdempotencyModule.forRoot({ allowInMemoryStorage: true, ttl: "1h", lockTtl: "30s", maxLockHold: "2m", storeTimeout: "5s", replayHeaders: ["cache-control", "location"],
    scope: (request: Request): string => (request.user as User).id,
  })], controllers: [DeploymentResourcesController], providers: [
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => state.roles }) },
    { provide: UpdateDeploymentResourcesCase, useValue: setup.resourceCase },
    { provide: GetDeploymentResourceUpdateCase, useValue: new GetDeploymentResourceUpdateCase(setup) },
  ] })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = state.authenticated ? new User({ ...setup.user, suspended: state.suspended }) : undefined;
    request.isAuthenticated = ((): boolean => state.authenticated) as Request["isAuthenticated"];
    next();
  });
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  return { setup, state,
    patch: (key: string = "request", body: unknown = BODY, version: string | null = VERSION, id: string = ID): Promise<globalThis.Response> => fetch(`${base}/deployments/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}), ...(version === null ? {} : { "If-Match": version }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    }),
    get: (operationId: string): Promise<globalThis.Response> => fetch(`${base}/deployments/${ID}/resource-updates/${operationId}`, { signal: AbortSignal.timeout(5_000) }),
  };
}

test("resource HTTP accepts 202, replays Location and rejects changed If-Match under the same key", async (context: TestContext): Promise<void> => {
  const api: HTTPFixture = await fixture(context);
  const accepted: globalThis.Response = await api.patch();
  assert.equal(accepted.status, 202);
  assert.match(accepted.headers.get("cache-control") ?? "", /private.*no-store/);
  const receipt: Record<string, unknown> = await accepted.json() as Record<string, unknown>;
  assert.equal(receipt.deployment_id, ID); assert.equal(receipt.status, "PENDING");
  assert.deepEqual(receipt.requested, BODY);
  assert.match(String(receipt.operation_id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(accepted.headers.get("location"), `/deployments/${ID}/resource-updates/${String(receipt.operation_id)}`);
  const calls: number = api.setup.stripeCalls;
  const replay: globalThis.Response = await api.patch("request", { max_scaling: 3, min_scaling: 0, max_memory: 2, max_vcpu: 1 });
  assert.equal(replay.status, 202); assert.deepEqual(await replay.json(), receipt);
  assert.equal(replay.headers.get("location"), accepted.headers.get("location"));
  assert.equal((await api.patch("request", BODY, '"different-version"')).status, 422);
  assert.equal(api.setup.updates.size, 1); assert.equal(api.setup.stripeCalls, calls);
  const progress: globalThis.Response = await api.get(String(receipt.operation_id));
  assert.equal(progress.status, 200);
  const serialized: string = JSON.stringify(await progress.json());
  assert.doesNotMatch(serialized, /claim_token|claimToken|key_hash|keyHash|fingerprint|cus_alice/);
});

test("resource HTTP checks current permissions before replay and Super cannot bypass ownership", async (context: TestContext): Promise<void> => {
  const api: HTTPFixture = await fixture(context);
  api.state.roles = [];
  assert.equal((await api.patch()).status, 403); assert.equal(api.setup.stripeCalls, 0);
  api.state.roles = roles(); assert.equal((await api.patch()).status, 202);
  const calls: number = api.setup.stripeCalls;
  api.state.roles = []; assert.equal((await api.patch()).status, 403);
  api.state.roles = [new Role({ id: "super", name: "Super", permission: 1n })];
  assert.equal((await api.patch("foreign", BODY, VERSION, "10000000-0000-4000-8000-000000000099")).status, 404);
  api.state.suspended = true; assert.equal((await api.patch()).status, 403);
  api.state.suspended = false; api.state.authenticated = false;
  assert.equal((await api.patch()).status, 403);
  assert.equal(api.setup.stripeCalls, calls); assert.equal(api.setup.updates.size, 1);
});

test("resource HTTP validates strict DTO, key, precondition and active subscription before enqueue", async (context: TestContext): Promise<void> => {
  const api: HTTPFixture = await fixture(context);
  const invalid: readonly unknown[] = [
    {}, { ...BODY, repo: "https://github.com/foreign/repo" }, { ...BODY, max_vcpu: "1" },
    { ...BODY, max_memory: 1 }, { ...BODY, min_scaling: -1 }, { ...BODY, max_scaling: 0 },
  ];
  for (let index: number = 0; index < invalid.length; index++) assert.equal((await api.patch(`invalid-${index}`, invalid[index])).status, 400);
  assert.equal((await api.patch("")).status, 400);
  assert.equal((await api.patch("no-version", BODY, null)).status, 428);
  assert.equal((await api.patch("invalid-id", BODY, VERSION, "bad-id")).status, 400);
  assert.equal(api.setup.stripeCalls, 0); assert.equal(api.setup.updates.size, 0);
  assert.equal((await api.patch("stale", BODY, '"stale-version"')).status, 412);
  api.setup.products = [];
  assert.equal((await api.patch("expired", { max_vcpu: 0.25, max_memory: 0.5, min_scaling: 0, max_scaling: 1 })).status, 403);
  assert.equal(api.setup.updates.size, 0);
});
