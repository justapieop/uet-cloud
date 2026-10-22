import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { SubscribeToPlanCase, type PlanSubscriptionResult } from "@kumo/application";
import { Plan, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { PlanSubscriptionsController } from "../dist/controllers/PlanSubscriptions.controller.js";
import { createPlanCheckoutRedirects } from "../dist/common/PlanCheckout.options.js";

test("Checkout redirects use the configured frontend dashboard and reject unsafe URL schemes", (): void => {
  assert.deepEqual(createPlanCheckoutRedirects("https://kumo.example/base/?untrusted=1#fragment"), {
    successUrl: "https://kumo.example/base/dashboard", cancelUrl: "https://kumo.example/base/dashboard",
  });
  assert.throws((): unknown => createPlanCheckoutRedirects("javascript:alert(1)"));
  assert.throws((): unknown => createPlanCheckoutRedirects("https://user:password@kumo.example"));
});

test("plan subscription HTTP validates session/input, uses owner billing identity, and returns only a hosted Checkout URL", async (context: TestContext): Promise<void> => {
  let calls: number = 0;
  const useCase: SubscribeToPlanCase = new SubscribeToPlanCase(
    { findById: async (id: string): Promise<User> => {
      assert.equal(id, "123"); return new User({ id, displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
    } },
    { findById: async (id: string): Promise<Plan | null> => id === "starter" ? new Plan({ id, name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, stripeProductId: "prod_starter" }) : null },
    {
      getPlanDefaultPriceId: async (productId: string): Promise<string> => { assert.equal(productId, "prod_starter"); return "price_monthly"; },
      createPlanCheckoutSession: async (input): Promise<PlanSubscriptionResult> => {
        assert.equal(input.customerId, "cus_alice"); assert.equal(input.priceId, "price_monthly"); calls++;
        return { checkoutSessionId: "cs_123", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_123" };
      },
    },
    { successUrl: "https://kumo.example/dashboard", cancelUrl: "https://kumo.example/dashboard" },
  );
  class SubscriptionModule {}
  Module({ controllers: [PlanSubscriptionsController], providers: [{ provide: SubscribeToPlanCase, useValue: useCase }] })(SubscriptionModule);
  const app: INestApplication = await NestFactory.create(SubscriptionModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ id: "123", displayName: "Alice", active: identity !== "inactive", suspended: identity === "suspended" }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const send: (identity: string, body?: object, key?: string, plan?: string) => Promise<globalThis.Response> = (identity: string, body: object = {}, key: string = "request-1", plan: string = "starter"): Promise<globalThis.Response> => fetch(`${base}/plans/${plan}/subscriptions`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": identity, ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await send("")).status, 403);
  assert.equal((await send("inactive")).status, 403);
  assert.equal((await send("suspended")).status, 403);
  assert.equal((await send("alice", undefined, "")).status, 400);
  assert.equal((await send("alice", { price_id: "price_monthly", customer_id: "cus_victim" })).status, 400);
  assert.equal((await send("alice", { price_id: "price_cheap_legacy" })).status, 400);
  assert.equal((await send("alice", { price_id: "price_monthly", success_url: "https://attacker.example" })).status, 400);
  assert.equal((await send("alice", undefined, "request-1", "missing")).status, 404);
  assert.equal(calls, 0);
  const response: globalThis.Response = await send("alice");
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { checkout_session_id: "cs_123", checkout_url: "https://checkout.stripe.com/c/pay/cs_123" });
  assert.equal(calls, 1);
  const noBody: globalThis.Response = await fetch(`${base}/plans/starter/subscriptions`, { method: "POST", headers: { "x-test-user": "alice", "Idempotency-Key": "request-no-body" } });
  assert.equal(noBody.status, 201);
});
