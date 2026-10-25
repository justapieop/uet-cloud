import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { IdempotencyModule } from "@nestjs/idempotency";
import { CheckPermissionsCase, RedeployDeploymentCase } from "@kumo/application";
import { Deployment, Permission, Role, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { RedeploymentsController } from "../dist/controllers/Redeployments.controller.js";
import { RouteReadCache } from "../dist/common/ReadCache.js";
import { AdmissionFixture, SPEC } from "../../application/test/support/admission.ts";

test("redeploy HTTP enforces permissions/ownership, queues once and replays its acceptance", async (context: TestContext): Promise<void> => {
  const setup: AdmissionFixture = new AdmissionFixture();
  const id: string = "00000000-0000-4000-8000-000000000001";
  setup.deployments = [new Deployment({ id, userId: "123", name: "my-app", spec: SPEC, status: "RUNNING", resourceId: "owned-resource" })];
  let roles: Role[] = [];
  let authenticated: boolean = true;
  let suspended: boolean = false;
  let invalidations: number = 0;
  class FixtureModule {}
  Module({ imports: [IdempotencyModule.forRoot({ allowInMemoryStorage: true, ttl: "1h", lockTtl: "30s", maxLockHold: "2m", storeTimeout: "5s",
    scope: (request: Request): string => (request.user as User).id,
  })], controllers: [RedeploymentsController], providers: [
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles }) },
    { provide: RedeployDeploymentCase, useValue: new RedeployDeploymentCase(setup, setup) },
    { provide: RouteReadCache, useValue: { invalidateDeployments: async (userId: string): Promise<void> => { assert.equal(userId, "123"); invalidations++; } } },
  ] })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ ...setup.user, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const post: (key?: string, body?: unknown, deploymentId?: string) => Promise<globalThis.Response> = (key: string = "request", body: unknown = {}, deploymentId: string = id): Promise<globalThis.Response> => fetch(`${base}/deployments/${deploymentId}/redeploy`, {
    method: "POST", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await post()).status, 403);
  assert.equal(setup.stripeCalls, 0);
  roles = [new Role({ id: "updater", name: "Updater", permission: 1n << BigInt(Permission.DeploymentUpdate.offset) })];
  assert.equal((await post("")).status, 400);
  assert.equal((await post("invalid", { resource_id: "foreign" })).status, 400);
  assert.equal((await post("foreign", {}, "00000000-0000-4000-8000-000000000002")).status, 404);
  const accepted: globalThis.Response = await post();
  assert.equal(accepted.status, 202);
  const snapshot: Record<string, unknown> = await accepted.json() as Record<string, unknown>;
  assert.equal(snapshot.id, id);
  assert.equal(snapshot.status, "PENDING");
  assert.equal(snapshot.build_id, null);
  assert.equal(setup.deployments.length, 1);
  assert.equal(invalidations, 1);
  const replay: globalThis.Response = await post();
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), snapshot);
  assert.equal(setup.stripeCalls, 1);
  assert.equal((await post("another")).status, 409);
  roles = [];
  assert.equal((await post()).status, 403);
  roles = [new Role({ id: "super", name: "Super", permission: 1n })];
  suspended = true;
  assert.equal((await post()).status, 403);
  authenticated = false;
  assert.equal((await post()).status, 403);
});
