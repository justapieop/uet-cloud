import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { CheckPermissionsCase, ManageScaleRuleCase, VolumeOperationCoordinator, type UnitOfWork, type UnitOfWorkRepositories } from "@kumo/application";
import { Deployment, Plan, Role, ScaleRule, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { ScaleRulesController } from "../dist/controllers/ScaleRules.controller.js";
import { emptyRepositories } from "../../application/test/support/repositories.ts";

test("scale rule HTTP CRUD uses real authorization, validation, ownership, and serialization", async (context: TestContext): Promise<void> => {
  const id: string = "00000000-0000-4000-8000-000000000001";
  const user: User = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
  const deployment: Deployment = new Deployment({ id, userId: "123", name: "my-app", status: "RUNNING", resourceId: "/azure/app",
    spec: { repo: "https://github.com/owner/repo", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 3 } });
  let rule: ScaleRule | null = null;
  let sessionUser: User | undefined = user;
  let roles: Role[] = [];
  let stripeCalls: number = 0;
  const uow: UnitOfWork = { run: async <T>(work: (repo: UnitOfWorkRepositories) => Promise<T>): Promise<T> => work({
    ...emptyRepositories(),
    users: { ...emptyRepositories().users, findById: async (): Promise<User> => user, findByIdForUpdate: async (): Promise<User> => user },
    deployment: { ...emptyRepositories().deployment,
      findByIdAndUserId: async (deploymentId: string, userId: string): Promise<Deployment | null> => deploymentId === id && userId === "123" ? deployment : null,
      countReservedByUserId: async (): Promise<number> => 1,
    },
    plans: { findActiveByStripeProductIds: async (): Promise<Plan[]> => [new Plan({ id: "plan", name: "Plan", price: 5, vcpu: 0.5, memory: 1, deployments: 1, maxReplicas: 3, disk: 32, stripeProductId: "prod_plan" })] },
    scaleRules: { findByDeploymentId: async (): Promise<ScaleRule | null> => rule, save: async (saved: ScaleRule): Promise<void> => { rule = saved; }, delete: async (): Promise<void> => { rule = null; } },
  }) };
  const manager: ManageScaleRuleCase = new ManageScaleRuleCase(uow, { getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => { stripeCalls++; return ["prod_plan"]; } }, new VolumeOperationCoordinator());
  class FixtureModule {}
  Module({ controllers: [ScaleRulesController], providers: [
    { provide: ManageScaleRuleCase, useValue: manager },
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles }) },
  ] })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = sessionUser;
    request.isAuthenticated = ((): boolean => Boolean(sessionUser)) as Request["isAuthenticated"]; next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const path: string = `/deployments/${id}/scale-rule`;
  const body: Record<string, unknown> = { enabled: true, metric: "cpu", scale_out_threshold: 80, scale_in_threshold: 20,
    min_replicas: 1, max_replicas: 3, evaluation_window_seconds: 120, cooldown_seconds: 300 };
  const send: (method: string, data?: Record<string, unknown>, route?: string) => Promise<globalThis.Response> = (method: string, data?: Record<string, unknown>, route: string = path): Promise<globalThis.Response> =>
    fetch(base + route, { method, headers: { "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  assert.equal((await send("GET")).status, 403);
  assert.equal((await send("POST", body)).status, 403); assert.equal(stripeCalls, 0);
  roles = [new Role({ id: "super", name: "Super", permission: 1n })];
  assert.equal((await send("GET", undefined, path + "s")).status, 200);
  assert.equal((await send("GET")).status, 404);
  assert.equal((await send("POST", { ...body, scale_in_threshold: 85 })).status, 400);
  assert.equal((await send("POST", { ...body, owner: "456" })).status, 400);
  assert.equal((await send("POST", { ...body, min_replicas: 0 })).status, 400);
  assert.equal((await send("POST", { ...body, max_replicas: 4 })).status, 409);
  const created: globalThis.Response = await send("POST", body);
  assert.equal(created.status, 201);
  const json: Record<string, unknown> = await created.json() as Record<string, unknown>;
  assert.equal(json.deployment_id, id); assert.equal(json.last_action, "NO_ACTION");
  assert.equal(json.deploymentId, undefined); assert.equal(json.next_evaluation_at, undefined);
  assert.equal(created.headers.get("cache-control"), "private, no-store");
  assert.equal((await send("POST", body)).status, 409);
  assert.equal((await send("PATCH", { deployment_id: "other" })).status, 400);
  assert.equal((await send("PATCH", { enabled: null })).status, 400);
  assert.equal((await send("PATCH", { scale_out_threshold: 10 })).status, 400);
  const beforeDisable: number = stripeCalls;
  assert.equal((await send("PATCH", { enabled: false })).status, 200); assert.equal(stripeCalls, beforeDisable);
  assert.equal((await send("PATCH", { enabled: true })).status, 200);
  const listed: ScaleRule[] = await (await send("GET", undefined, path + "s")).json() as ScaleRule[]; assert.equal(listed.length, 1);
  sessionUser = new User({ id: "456", displayName: "Bob", suspended: false });
  assert.equal((await send("GET")).status, 404);
  assert.equal((await send("PATCH", { enabled: false })).status, 404);
  assert.equal((await send("DELETE")).status, 404);
  sessionUser = user;
  assert.equal((await send("GET", undefined, "/deployments/not-a-uuid/scale-rule")).status, 400);
  assert.equal((await send("DELETE")).status, 204); assert.equal(rule, null);
  assert.equal((await send("DELETE")).status, 204);
  sessionUser = undefined; assert.equal((await send("GET")).status, 403);
});
