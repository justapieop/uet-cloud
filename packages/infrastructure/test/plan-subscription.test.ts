import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { PlanSubscriptionConflict, PlanSubscriptionUnavailable } from "@kumo/application";
import { StripeProvider } from "../dist/stripe/provider.js";

test("Stripe checkout uses only the product default price and fails closed on invalid configuration and returns a hosted Checkout URL", async (): Promise<void> => {
  const price: object = { id: "price_monthly", active: true, type: "recurring", recurring: { usage_type: "licensed" }, product: "prod_starter" };
  let product: object = { id: "prod_starter", active: true, default_price: price };
  let failure: unknown;
  let checkoutUrl: string | null = "https://checkout.stripe.com/c/pay/cs_123";
  const input: { customerId: string; priceId: string; idempotencyKey: string; successUrl: string; cancelUrl: string } = { customerId: "cus_alice", priceId: "price_monthly", idempotencyKey: "stable-key", successUrl: "https://kumo.example/dashboard", cancelUrl: "https://kumo.example/dashboard" };
  const client: Stripe = {
    products: { retrieve: async (id: string, params: { expand: string[] }): Promise<object> => {
      assert.equal(id, "prod_starter"); assert.deepEqual(params.expand, ["default_price"]); return product;
    } },
    checkout: { sessions: { create: async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions): Promise<object> => {
      assert.deepEqual(params, { mode: "subscription", ui_mode: "hosted", customer: "cus_alice", line_items: [{ price: "price_monthly", quantity: 1 }], success_url: input.successUrl, cancel_url: input.cancelUrl });
      assert.equal(options.idempotencyKey, "stable-key");
      if (failure) throw failure;
      return { id: "cs_123", url: checkoutUrl, metadata: { internal: "private" } };
    } } },
  } as unknown as Stripe;
  const provider: StripeProvider = new StripeProvider(client);
  assert.equal(await provider.getPlanDefaultPriceId("prod_starter"), "price_monthly");
  assert.deepEqual(await provider.createPlanCheckoutSession(input), { checkoutSessionId: "cs_123", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_123" });
  const invalidProducts: object[] = [
    { id: "prod_starter", active: false, default_price: price },
    { id: "prod_starter", deleted: true },
    { id: "prod_other", active: true, default_price: price },
    { id: "prod_starter", active: true, default_price: null },
    { id: "prod_starter", active: true, default_price: "price_unexpanded" },
    ...[
      { active: false }, { type: "one_time" }, { recurring: { usage_type: "metered" } }, { product: "prod_other" },
    ].map((patch: object): object => ({ id: "prod_starter", active: true, default_price: { ...price, ...patch } })),
  ];
  for (let index: number = 0; index < invalidProducts.length; index++) {
    product = invalidProducts[index]!;
    await assert.rejects(provider.getPlanDefaultPriceId("prod_starter"), PlanSubscriptionUnavailable);
  }
  checkoutUrl = null;
  await assert.rejects(provider.createPlanCheckoutSession(input), PlanSubscriptionUnavailable);
  failure = { type: "StripeIdempotencyError", message: "secret upstream body" };
  await assert.rejects(provider.createPlanCheckoutSession(input), PlanSubscriptionConflict);
  failure = new Error("secret upstream body");
  await assert.rejects(provider.createPlanCheckoutSession(input), (error: unknown): boolean => error instanceof PlanSubscriptionUnavailable && !error.message.includes("secret upstream"));
});
