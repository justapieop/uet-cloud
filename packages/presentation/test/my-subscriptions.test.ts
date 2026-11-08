import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { AdminSubscriptionsCase, AdminBillingNotFound, AdminBillingUnavailable, CheckPermissionsCase, type AdminSubscription, type AdminSubscriptionPage } from "@kumo/application";
import { User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { MySubscriptionsController, UserSubscriptionsController } from "../dist/controllers/UserSubscriptions.controller.js";

test("self-service subscriptions use the persisted session owner without management grants", async (context: TestContext): Promise<void> => {
  let linked: boolean = true;
  let unavailable: boolean = false;
  let reads: number = 0;
  let writes: number = 0;
  const keys: string[] = [];
  const subscription: AdminSubscription = { id: "sub_owned", status: "active", cancelAtPeriodEnd: false, cancelAt: null, items: [{ priceId: "price_base", productId: "prod_starter" }] };
  const subscriptions: AdminSubscriptionsCase = new AdminSubscriptionsCase({
    findById: async (id: string): Promise<User> => {
      reads++; assert.equal(id, "123");
      return new User({ id, displayName: "Alice", suspended: false, stripeCustomerId: linked ? "cus_persisted" : null });
    },
  }, {
    listCustomerSubscriptions: async (customer: string, limit: number, cursor?: string): Promise<AdminSubscriptionPage> => {
      assert.equal(customer, "cus_persisted"); assert.equal(limit, 2); assert.equal(cursor, "sub_previous");
      if (unavailable) throw new AdminBillingUnavailable("Subscription management unavailable");
      return { subscriptions: [subscription], hasMore: true, nextCursor: "sub_owned" };
    },
    setSubscriptionCancellation: async (customer: string, id: string, cancel: boolean, key: string): Promise<AdminSubscription> => {
      assert.equal(customer, "cus_persisted");
      if (id !== "sub_owned") throw new AdminBillingNotFound("Subscription not found for this user");
      writes++; keys.push(key); return { ...subscription, cancelAtPeriodEnd: cancel };
    },
  });
  class SubscriptionModule {}
  Module({ controllers: [MySubscriptionsController, UserSubscriptionsController], providers: [
    { provide: AdminSubscriptionsCase, useValue: subscriptions },
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async () => [] }) },
  ] })(SubscriptionModule);
  const app: INestApplication = await NestFactory.create(SubscriptionModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ id: "123", displayName: "Alice", active: identity !== "inactive", suspended: identity === "suspended", stripeCustomerId: "cus_stale" }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const listPath: string = "/user/me/subscriptions?limit=2&starting_after=sub_previous";
  const send: (path: string, method?: string, body?: object, identity?: string, key?: string) => Promise<globalThis.Response> =
    (path: string, method: string = "GET", body?: object, identity: string = "alice", key: string = "retry-1"): Promise<globalThis.Response> => fetch(base + path, {
      method, headers: { "content-type": "application/json", "x-test-user": identity, ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const identities: string[] = ["", "inactive", "suspended"];
  for (let index: number = 0; index < identities.length; index++) {
    const identity: string = identities[index]!;
    assert.equal((await send(listPath, "GET", undefined, identity)).status, 403);
    assert.equal((await send("/user/me/subscriptions/sub_owned", "PATCH", { cancel_at_period_end: true }, identity)).status, 403);
  }
  assert.equal(reads, 0);
  assert.equal((await send("/user/456/subscriptions")).status, 403);
  assert.equal((await send("/user/me/subscriptions?user_id=456")).status, 400);
  assert.equal((await send("/user/me/subscriptions?limit=101")).status, 400);
  const response: globalThis.Response = await send(listPath);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { subscriptions: [{ id: "sub_owned", status: "active", cancel_at_period_end: false, cancel_at: null, items: [{ price_id: "price_base", product_id: "prod_starter" }] }], has_more: true, next_cursor: "sub_owned" });
  const path: string = "/user/me/subscriptions/sub_owned";
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: true }, "alice", "")).status, 400);
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: "true" })).status, 400);
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: true, user_id: "456" })).status, 400);
  assert.equal((await send("/user/me/subscriptions/bad", "PATCH", { cancel_at_period_end: true })).status, 400);
  assert.equal((await send("/user/me/subscriptions/sub_foreign", "PATCH", { cancel_at_period_end: true })).status, 404);
  assert.equal(writes, 0);
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: true })).status, 200);
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: true })).status, 200);
  assert.equal(keys[0], keys[1]);
  const undo: globalThis.Response = await send(path, "PATCH", { cancel_at_period_end: false }, "alice", "retry-2");
  assert.equal(undo.status, 200); assert.equal((await undo.json() as { cancel_at_period_end: boolean }).cancel_at_period_end, false);
  assert.notEqual(keys[0], keys[2]);
  linked = false;
  assert.deepEqual(await (await send(listPath)).json(), { subscriptions: [], has_more: false, next_cursor: null });
  assert.equal((await send(path, "PATCH", { cancel_at_period_end: true })).status, 404);
  linked = true; unavailable = true;
  assert.equal((await send(listPath)).status, 503);
});
