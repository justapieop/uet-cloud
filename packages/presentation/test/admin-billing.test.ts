import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { AdminBillingConflict, AdminBillingNotFound, AdminPlansCase, AdminSubscriptionsCase, CheckPermissionsCase, GetPlansCase, GetUserPlansCase, type AdminPlanRepository, type AdminSubscription } from "@kumo/application";
import { Plan, Permission, Role, User, type PermissionDefinition } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { PlansController } from "../dist/controllers/Plans.controller.js";
import { UserPlansController } from "../dist/controllers/UserPlans.controller.js";
import { UserSubscriptionsController } from "../dist/controllers/UserSubscriptions.controller.js";

test("unified billing routes require independent grants and validates plan writes and cancellation requests over HTTP", async (context: TestContext): Promise<void> => {
  let roles: Role[] = [];
  let inactive: boolean = false;
  let authenticated: boolean = true;
  let reads: number = 0;
  let writes: number = 0;
  const records: Map<string, Plan> = new Map();
  const repository: AdminPlanRepository = {
    list: async (page: number, perPage: number): Promise<Plan[]> => { reads++; return [...records.values()].slice((page - 1) * perPage, page * perPage + 1); },
    findById: async (id: string): Promise<Plan | null> => { reads++; return records.get(id) ?? null; },
    insert: async (plan: Plan): Promise<void> => { if (records.has(plan.id)) throw new AdminBillingConflict(); writes++; records.set(plan.id, plan); },
    replace: async (plan: Plan): Promise<void> => { if (!records.has(plan.id)) throw new AdminBillingNotFound(); writes++; records.set(plan.id, plan); },
    deactivate: async (id: string): Promise<void> => { const plan: Plan | undefined = records.get(id); if (!plan) throw new AdminBillingNotFound(); writes++; records.set(id, new Plan({ ...plan, active: false })); },
  };
  const keys: string[] = [];
  const subscription: AdminSubscription = { id: "sub_alice", status: "active", cancelAtPeriodEnd: false, cancelAt: null, items: [{ priceId: "price_base", productId: "prod_starter" }] };
  class AdminModule {}
  Module({ controllers: [UserPlansController, PlansController, UserSubscriptionsController], providers: [
    { provide: GetPlansCase, useValue: new GetPlansCase({ findAvailable: async (): Promise<Plan[]> => [...records.values()].filter((plan: Plan): boolean => plan.active) }) },
    { provide: GetUserPlansCase, useValue: { exec: async (): Promise<Plan[]> => [] } },
    { provide: AdminPlansCase, useValue: new AdminPlansCase(repository) },
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles }) },
    { provide: AdminSubscriptionsCase, useValue: new AdminSubscriptionsCase({ findById: async (id: string): Promise<User> => {
      reads++; assert.equal(id, "123"); return new User({ id, displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
    } }, {
      listCustomerSubscriptions: async (customer: string, limit: number, cursor?: string) => {
        assert.equal(customer, "cus_alice"); assert.equal(limit, 2); assert.equal(cursor, "sub_previous");
        return { subscriptions: [subscription], hasMore: true, nextCursor: "sub_alice" };
      },
      setSubscriptionCancellation: async (customer: string, id: string, cancel: boolean, key: string): Promise<AdminSubscription> => {
        assert.equal(customer, "cus_alice"); assert.equal(id, "sub_alice"); writes++; keys.push(key); return { ...subscription, cancelAtPeriodEnd: cancel };
      },
    }) },
  ] })(AdminModule);
  const app: INestApplication = await NestFactory.create(AdminModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = new User({ id: "admin", displayName: "Administrator", active: !inactive, suspended: false });
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"]; next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const send: (path: string, method?: string, body?: object, key?: string) => Promise<globalThis.Response> = (path: string, method: string = "GET", body?: object, key: string = "operation-1"): Promise<globalThis.Response> => fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const grant: (permission: PermissionDefinition) => void = (permission: PermissionDefinition): void => {
    roles = [new Role({ id: "operator", name: "Operator", permission: 1n << BigInt(permission.offset) })];
  };
  const body: { id: string; name: string; price: number; vcpu: number; memory: number; deployments: number; disk: number; active: boolean; stripe_product_id: string; max_replicas: number } = {
    id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, active: true, stripe_product_id: "prod_starter", max_replicas: 3,
  };
  const denied: readonly [string, string, object?][] = [
    ["/plans/all", "GET"], ["/plans/starter", "GET"], ["/plans", "POST", body], ["/plans/starter", "PUT", body], ["/plans/starter", "DELETE"],
    ["/user/123/subscriptions", "GET"], ["/user/123/subscriptions/sub_alice", "PATCH", { cancel_at_period_end: true }],
  ];
  grant(Permission.DeploymentUpdate);
  for (let index: number = 0; index < denied.length; index++) {
    const [path, method, value]: readonly [string, string, object?] = denied[index]!;
    assert.equal((await send(path, method, value)).status, 403);
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
  assert.equal((await send("/plans")).status, 200);
  assert.equal((await send("/plans/me")).status, 200);
  assert.equal((await send("/admin/plans")).status, 404);
  assert.equal((await send("/admin/users/123/subscriptions")).status, 404);
  grant(Permission.PlanManage);
  assert.equal((await send("/user/123/subscriptions")).status, 403);
  assert.equal((await send("/plans", "POST", { ...body, memory: 3 })).status, 400);
  const created: globalThis.Response = await send("/plans", "POST", body);
  assert.equal(created.status, 201); assert.equal(created.headers.get("cache-control"), "private, no-store");
  assert.equal((await created.json() as { stripe_product_id: string }).stripe_product_id, "prod_starter");
  assert.equal((await send("/plans", "POST", body)).status, 409);
  const { id: _id, ...replacement }: typeof body = body;
  assert.equal((await send("/plans/starter", "PUT", { ...replacement, name: "Updated" })).status, 200);
  assert.equal((await send("/plans/starter", "PUT", { active: false })).status, 400);
  assert.equal((await send("/plans/starter", "DELETE")).status, 204);
  const page: { plans: { active: boolean }[]; has_next_page: boolean } = await (await send("/plans/all?per_page=1")).json();
  assert.equal(page.plans[0]?.active, false); assert.equal(page.has_next_page, false);
  assert.equal((await send("/plans/missing")).status, 404);
  grant(Permission.SubscriptionManage);
  assert.equal((await send("/plans/all")).status, 403);
  const subscriptions: globalThis.Response = await send("/user/123/subscriptions?limit=2&starting_after=sub_previous");
  assert.equal(subscriptions.status, 200);
  const list: { has_more: boolean; next_cursor: string } = await subscriptions.json();
  assert.equal(list.has_more, true); assert.equal(list.next_cursor, "sub_alice");
  assert.equal((await send("/user/123/subscriptions/sub_alice", "PATCH", { cancel_at_period_end: true }, "")).status, 400);
  assert.equal((await send("/user/123/subscriptions/sub_alice", "PATCH", { cancel_at_period_end: true, customer_id: "cus_victim" })).status, 400);
  assert.equal((await send("/user/123/subscriptions/sub_alice", "PATCH", { cancel_at_period_end: true })).status, 200);
  assert.equal((await send("/user/123/subscriptions/sub_alice", "PATCH", { cancel_at_period_end: false }, "operation-2")).status, 200);
  assert.notEqual(keys[0], keys[1]);
  inactive = true;
  assert.equal((await send("/user/123/subscriptions")).status, 403);
  inactive = false; grant(Permission.Super);
  assert.equal((await send("/plans/all")).status, 200);
  authenticated = false;
  assert.equal((await send("/plans")).status, 200);
  assert.equal((await send("/plans/me")).status, 403);
  assert.equal((await send("/plans/all")).status, 403);
});
