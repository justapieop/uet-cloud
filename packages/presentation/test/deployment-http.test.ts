import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { IdempotencyModule } from "@nestjs/idempotency";
import { CheckPermissionsCase, CreateDeploymentCase, GetBuildCase, GetDeploymentCase, StartDeploymentCase, StopDeploymentCase } from "@kumo/application";
import { Permission, Plan, Role, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { RouteReadCache } from "../dist/common/ReadCache.js";
import { AdmissionFixture, PLAN } from "../../application/test/support/admission.ts";

test("deployment HTTP contract enforces guards, validation, quotas, serialization and idempotent replay", async (context: TestContext): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.plans = [new Plan({ ...PLAN, deployments: 1 })];
  let roles: Role[] = [];
  class FixtureModule {}
  Module({
    imports: [IdempotencyModule.forRoot({
      allowInMemoryStorage: true, ttl: "1h", lockTtl: "30s", maxLockHold: "2m", storeTimeout: "5s",
      scope: (request: Request): string => (request.user as User).id,
      storeIf: (status: number): boolean => (status >= 200 && status < 300) || status === 400 || status === 422,
    })],
    controllers: [DeploymentsController],
    providers: [
      { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles }) },
      { provide: CreateDeploymentCase, useValue: fixture.useCase },
      { provide: GetDeploymentCase, useValue: {} },
      { provide: GetBuildCase, useValue: {} },
      { provide: StartDeploymentCase, useValue: {} },
      { provide: StopDeploymentCase, useValue: {} },
      RouteReadCache,
      { provide: CACHE_MANAGER, useValue: { get: async (): Promise<undefined> => undefined, set: async (): Promise<void> => {} } },
    ],
  })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ ...fixture.user, suspended: identity === "suspended" }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/deployments`;
  const body: Record<string, unknown> = { name: "my-app", repo: "https://github.com/owner/repo", target_port: 8080, max_vcpu: 0.5, max_memory: 1, min_scaling: 0, max_scaling: 2, env_vars: { SECRET: "never-serialize-this" } };
  const post: (key: string | undefined, patch?: Record<string, unknown>, identity?: string) => Promise<globalThis.Response> =
    (key: string | undefined, patch: Record<string, unknown> = {}, identity: string = "alice"): Promise<globalThis.Response> => fetch(url, {
      method: "POST", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}), ...(identity ? { "x-test-user": identity } : {}) }, body: JSON.stringify({ ...body, ...patch }),
    });
  assert.equal((await post("accept", {}, "")).status, 403);
  assert.equal((await post("accept")).status, 403);
  assert.equal(fixture.stripeCalls, 0);
  assert.equal(fixture.deployments.length, 0);
  roles = [new Role({ id: "creator", name: "Creator", permission: 1n << BigInt(Permission.DeploymentCreate.offset) })];
  assert.equal((await post(undefined)).status, 400);
  assert.equal((await post("invalid", { unexpected: true })).status, 400);
  assert.equal((await post("caller-tag", { tag: "v1" })).status, 400);
  assert.equal((await post("invalid-port", { target_port: 0 })).status, 400);
  assert.equal((await post("invalid-external", { external: "false" })).status, 400);
  assert.equal((await post("null-external", { external: null })).status, 400);
  assert.equal((await post("internal-public-port", { external: false, additional_ports: [{ target_port: 9000, external: true }] })).status, 400);
  assert.equal(fixture.stripeCalls, 0);
  body.additional_ports = [{ target_port: 9000, exposed_port: 9001, external: true }];
  const accepted: globalThis.Response = await post("accept");
  assert.equal(accepted.status, 202);
  const snapshot: Record<string, unknown> = await accepted.json() as Record<string, unknown>;
  assert.equal(snapshot.status, "PENDING");
  assert.equal(snapshot.max_vcpu, 0.5);
  assert.equal(snapshot.external, true);
  assert.deepEqual(snapshot.additional_ports, [{ target_port: 9000, exposed_port: 9001, external: true }]);
  assert.deepEqual(fixture.deployments[0]?.spec?.additionalPorts, [{ targetPort: 9000, exposedPort: 9001, external: true }]);
  assert.equal(snapshot.maxVcpu, undefined);
  assert.equal(snapshot.spec, undefined);
  assert.ok(!JSON.stringify(snapshot).includes("never-serialize-this"));
  const replay: globalThis.Response = await post("accept");
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
  assert.deepEqual(await replay.json(), snapshot);
  assert.equal(fixture.stripeCalls, 1);
  roles = [];
  assert.equal((await post("accept")).status, 403);
  assert.equal(fixture.stripeCalls, 1);
  roles = [new Role({ id: "creator", name: "Creator", permission: 1n << BigInt(Permission.DeploymentCreate.offset) })];
  assert.equal((await post("accept", {}, "suspended")).status, 403);
  assert.equal((await post("accept", { name: "changed-app" })).status, 422);
  assert.equal((await post("accept", { external: false, additional_ports: [] })).status, 422);
  assert.equal((await post("quota", { name: "another-app" })).status, 409);
  fixture.products = [];
  assert.equal((await post("no-subscription", { name: "another-app" })).status, 403);
  fixture.stripeFailure = true;
  assert.equal((await post("stripe-failure", { name: "another-app" })).status, 503);
  assert.equal(fixture.deployments.length, 1);
  fixture.products = ["prod_starter"];
  fixture.stripeFailure = false;
  fixture.plans = [PLAN];
  const internal: globalThis.Response = await post("internal", { name: "internal-app", external: false, additional_ports: [{ target_port: 9000 }] });
  assert.equal(internal.status, 202);
  const internalBody: Record<string, unknown> = await internal.json() as Record<string, unknown>;
  assert.equal(internalBody.external, false);
  assert.deepEqual(internalBody.additional_ports, [{ target_port: 9000, exposed_port: 9000, external: false }]);
  assert.equal(fixture.deployments[1]?.spec?.external, false);
  const internalReplay: globalThis.Response = await post("internal", { name: "internal-app", external: false, additional_ports: [{ target_port: 9000 }] });
  assert.equal(internalReplay.status, 202);
  assert.deepEqual(await internalReplay.json(), internalBody);
});
