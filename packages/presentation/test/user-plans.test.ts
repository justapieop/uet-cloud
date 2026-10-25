import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { GetUserPlansCase } from "@kumo/application";
import { Plan, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { UserPlansController } from "../dist/controllers/UserPlans.controller.js";

test("current-plan HTTP checks only the session owner's active subscriptions and distinguishes absence from outages", async (context: TestContext): Promise<void> => {
  let user: User | null = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
  let products: readonly string[] = [];
  let matched: Plan[] = [];
  let unavailable: boolean = false;
  let stripeReads: number = 0;
  let planReads: number = 0;
  const useCase: GetUserPlansCase = new GetUserPlansCase(
    { findById: async (id: string): Promise<User | null> => { assert.equal(id, "123"); return user; } },
    { findActiveByStripeProductIds: async (ids: readonly string[]): Promise<Plan[]> => {
      planReads++; assert.deepEqual(ids, products); return matched;
    } },
    { getActiveSubscriptionProductIds: async (customer: string): Promise<readonly string[]> => {
      stripeReads++; assert.equal(customer, "cus_alice");
      if (unavailable) throw new Error("secret Stripe response");
      return products;
    } },
  );
  class CurrentPlansModule {}
  Module({ controllers: [UserPlansController], providers: [{ provide: GetUserPlansCase, useValue: useCase }] })(CurrentPlansModule);
  const app: INestApplication = await NestFactory.create(CurrentPlansModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ id: "123", displayName: "Alice", active: identity !== "inactive", suspended: identity === "suspended" }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/plans/me?user_id=456`;
  const get: (identity?: string) => Promise<globalThis.Response> = (identity: string = "alice"): Promise<globalThis.Response> => fetch(url, { headers: { "x-test-user": identity } });
  assert.equal((await get("")).status, 403);
  assert.equal((await get("inactive")).status, 403);
  assert.equal((await get("suspended")).status, 403);
  assert.equal(stripeReads, 0);
  const absent: globalThis.Response = await get();
  assert.equal(absent.status, 200);
  assert.equal(absent.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await absent.json(), { has_plan: false, plans: [] });
  assert.equal(planReads, 0);
  products = ["prod_unmapped"];
  assert.deepEqual(await (await get()).json(), { has_plan: false, plans: [] });
  products = ["prod_starter", "prod_second"];
  matched = [new Plan({ id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, stripeProductId: "prod_starter" }),
    new Plan({ id: "second", name: "Second", price: 10, vcpu: 2, memory: 4, deployments: 3, disk: 20, stripeProductId: "prod_second" })];
  const active: { has_plan: boolean; plans: { id: string }[] } = await (await get()).json();
  assert.equal(active.has_plan, true);
  assert.deepEqual(active.plans.map((plan: { id: string }): string => plan.id), ["starter", "second"]);
  assert.ok(!JSON.stringify(active).includes("prod_"));
  assert.ok(!JSON.stringify(active).includes("cus_"));
  unavailable = true;
  const failure: globalThis.Response = await get();
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes("secret Stripe"));
  const before: number = stripeReads;
  user = new User({ id: "123", displayName: "Alice", suspended: false });
  assert.deepEqual(await (await get()).json(), { has_plan: false, plans: [] });
  user = new User({ id: "123", displayName: "Alice", suspended: true, stripeCustomerId: "cus_alice" });
  assert.equal((await get()).status, 403);
  user = null;
  assert.equal((await get()).status, 403);
  assert.equal(stripeReads, before);
});
