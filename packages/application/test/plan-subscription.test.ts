import assert from "node:assert/strict";
import { test } from "node:test";
import { Plan, User } from "@kumo/domain";
import { InvalidPlanSubscription, PlanSubscriptionForbidden, SubscribeToPlanCase, SubscriptionPlanNotFound, type PlanCheckoutRedirects, type PlanSubscriptionGateway, type PlanSubscriptionPrice, type PlanSubscriptionResult } from "../dist/index.js";

const REDIRECTS: PlanCheckoutRedirects = { successUrl: "https://kumo.example/dashboard", cancelUrl: "https://kumo.example/dashboard" };
const PRICES: readonly PlanSubscriptionPrice[] = [{ id: "price_monthly", usageType: "licensed" }, { id: "price_cpu", usageType: "metered" }];
const PLAN: Plan = new Plan({ id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, stripeProductId: "prod_starter" });
const INPUT: { userId: string; planId: string; idempotencyKey: string } = { userId: "123", planId: PLAN.id, idempotencyKey: "request-1" };

test("subscription uses the persisted customer's identity and stable owner-scoped Stripe idempotency", async (): Promise<void> => {
  const keys: string[] = [];
  const users: Map<string, User> = new Map([
    ["123", new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" })],
    ["456", new User({ id: "456", displayName: "Bob", suspended: false, stripeCustomerId: "cus_bob" })],
  ]);
  const gateway: PlanSubscriptionGateway = {
    getPlanPrices: async (productId: string): Promise<readonly PlanSubscriptionPrice[]> => { assert.equal(productId, "prod_starter"); return PRICES; },
    createPlanCheckoutSession: async (input): Promise<PlanSubscriptionResult> => {
      assert.ok(["cus_alice", "cus_bob"].includes(input.customerId)); assert.deepEqual(input.prices, PRICES); keys.push(input.idempotencyKey);
      assert.equal(input.successUrl, REDIRECTS.successUrl); assert.equal(input.cancelUrl, REDIRECTS.cancelUrl);
      return { checkoutSessionId: "cs_1", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1" };
    },
  };
  const useCase: SubscribeToPlanCase = new SubscribeToPlanCase({ findById: async (id: string): Promise<User | null> => users.get(id) ?? null }, { findById: async (): Promise<Plan> => PLAN }, gateway, REDIRECTS);
  assert.equal((await useCase.exec(INPUT)).checkoutSessionId, "cs_1");
  await useCase.exec(INPUT);
  await useCase.exec({ ...INPUT, userId: "456" });
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[0], keys[2]);
  assert.ok(!keys[0]!.includes(INPUT.idempotencyKey));
});

test("ineligible users and unmapped/inactive plans never reach Stripe", async (): Promise<void> => {
  let user: User | null = null;
  let plan: Plan | null = PLAN;
  const useCase: SubscribeToPlanCase = new SubscribeToPlanCase(
    { findById: async (): Promise<User | null> => user }, { findById: async (): Promise<Plan | null> => plan },
    { getPlanPrices: async (): Promise<never> => { throw new Error("Unexpected Stripe access"); }, createPlanCheckoutSession: async (): Promise<never> => { throw new Error("Unexpected checkout"); } }, REDIRECTS,
  );
  await assert.rejects(useCase.exec(INPUT), PlanSubscriptionForbidden);
  const userVariants: User[] = [new User({ id: "123", displayName: "Alice", suspended: false, active: false }), new User({ id: "123", displayName: "Alice", suspended: true }), new User({ id: "123", displayName: "Alice", suspended: false })];
  for (let index: number = 0; index < userVariants.length; index++) {
    user = userVariants[index]!;
    await assert.rejects(useCase.exec(INPUT), PlanSubscriptionForbidden);
  }
  user = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
  const planVariants: (Plan | null)[] = [null, new Plan({ ...PLAN, active: false }), new Plan({ ...PLAN, stripeProductId: null })];
  for (let index: number = 0; index < planVariants.length; index++) {
    plan = planVariants[index]!;
    await assert.rejects(useCase.exec(INPUT), SubscriptionPlanNotFound);
  }
});

test("invalid idempotency input cannot create a checkout", async (): Promise<void> => {
  const useCase: SubscribeToPlanCase = new SubscribeToPlanCase(
    { findById: async (): Promise<User> => new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" }) },
    { findById: async (): Promise<Plan> => PLAN },
    { getPlanPrices: async (): Promise<never> => { throw new Error("Invalid input must not reach Stripe"); }, createPlanCheckoutSession: async (): Promise<never> => { throw new Error("Unexpected checkout"); } }, REDIRECTS,
  );
  await assert.rejects(useCase.exec({ ...INPUT, idempotencyKey: undefined }), InvalidPlanSubscription);
  await assert.rejects(useCase.exec({ ...INPUT, idempotencyKey: "bad\nkey" }), InvalidPlanSubscription);
});
