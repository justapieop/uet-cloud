import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { PlanSubscriptionConflict, PlanSubscriptionUnavailable, type PlanSubscriptionGateway, type PlanSubscriptionPrice } from "@kumo/application";
import { StripeProvider } from "../dist/stripe/provider.js";

function price(id: string, usageType: PlanSubscriptionPrice["usageType"], overrides: object = {}): Stripe.Price {
  return { id, active: true, product: "prod_starter", type: usageType === "one_time" ? "one_time" : "recurring",
    recurring: usageType === "one_time" ? null : { usage_type: usageType }, ...overrides } as Stripe.Price;
}

test("Checkout includes every active price across pages, with no quantity on metered items", async (): Promise<void> => {
  let pages: number = 0;
  let failure: unknown;
  let url: string | null = "https://checkout.stripe.com/c/pay/cs_123";
  const client: Stripe = {
    products: { retrieve: async (id: string): Promise<object> => { assert.equal(id, "prod_starter"); return { id, active: true }; } },
    prices: { list: async (params: Stripe.PriceListParams): Promise<object> => {
      pages++;
      assert.deepEqual(params, { product: "prod_starter", active: true, limit: 100, ...(pages === 2 ? { starting_after: "price_setup" } : {}) });
      return pages === 1
        ? { data: [price("price_base", "licensed"), price("price_archived", "licensed", { active: false }), price("price_setup", "one_time")], has_more: true }
        : { data: [price("price_storage", "metered"), price("price_ram", "metered"), price("price_cpu", "metered")], has_more: false };
    } },
    checkout: { sessions: { create: async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions): Promise<object> => {
      assert.deepEqual(params, { mode: "subscription", ui_mode: "hosted_page", customer: "cus_alice", line_items: [
        { price: "price_base", quantity: 1 }, { price: "price_cpu" }, { price: "price_ram" }, { price: "price_setup", quantity: 1 }, { price: "price_storage" },
      ], success_url: "https://kumo.example/dashboard", cancel_url: "https://kumo.example/dashboard" });
      assert.equal(options.idempotencyKey, "stable-key");
      if (failure) throw failure;
      return { id: "cs_123", url };
    } } },
  } as unknown as Stripe;
  const provider: StripeProvider = new StripeProvider(client);
  const prices: readonly PlanSubscriptionPrice[] = await provider.getPlanPrices("prod_starter");
  assert.equal(pages, 2);
  assert.deepEqual(prices.map((item: PlanSubscriptionPrice): string => item.id), ["price_base", "price_cpu", "price_ram", "price_setup", "price_storage"]);
  const input: Parameters<PlanSubscriptionGateway["createPlanCheckoutSession"]>[0] = {
    customerId: "cus_alice", prices, idempotencyKey: "stable-key", successUrl: "https://kumo.example/dashboard", cancelUrl: "https://kumo.example/dashboard",
  };
  assert.deepEqual(await provider.createPlanCheckoutSession(input), { checkoutSessionId: "cs_123", checkoutUrl: url });
  url = null;
  await assert.rejects(provider.createPlanCheckoutSession(input), PlanSubscriptionUnavailable);
  failure = { type: "StripeIdempotencyError", message: "secret upstream body" };
  await assert.rejects(provider.createPlanCheckoutSession(input), PlanSubscriptionConflict);
  failure = new Error("secret upstream body");
  await assert.rejects(provider.createPlanCheckoutSession(input), (error: unknown): boolean => error instanceof PlanSubscriptionUnavailable && !error.message.includes("secret upstream"));
});

test("price lookup fails closed for unavailable products, invalid pagination, foreign prices, and Checkout limits", async (): Promise<void> => {
  let product: object = { id: "prod_starter", active: true };
  let data: Stripe.Price[] = [];
  let more: boolean = false;
  let unavailable: boolean = false;
  const client: Stripe = {
    products: { retrieve: async (): Promise<object> => product },
    prices: { list: async (): Promise<object> => {
      if (unavailable) throw new Error("secret Stripe response");
      return { data, has_more: more };
    } },
  } as unknown as Stripe;
  const provider: StripeProvider = new StripeProvider(client);
  const invalid: Stripe.Price[][] = [[], [price("price_setup", "one_time")], [price("price_foreign", "licensed", { product: "prod_other" })],
    [price("price_bad", "licensed", { recurring: null })],
    Array.from({ length: 21 }, (_item: unknown, index: number): Stripe.Price => price(`price_r${index}`, "licensed")),
    [price("price_base", "licensed"), ...Array.from({ length: 21 }, (_item: unknown, index: number): Stripe.Price => price(`price_o${index}`, "one_time"))],
  ];
  for (let index: number = 0; index < invalid.length; index++) {
    data = invalid[index]!;
    await assert.rejects(provider.getPlanPrices("prod_starter"), PlanSubscriptionUnavailable);
  }
  data = [price("price_cpu", "metered")];
  assert.deepEqual(await provider.getPlanPrices("prod_starter"), [{ id: "price_cpu", usageType: "metered" }]);
  more = true;
  await assert.rejects(provider.getPlanPrices("prod_starter"), PlanSubscriptionUnavailable);
  data = [];
  await assert.rejects(provider.getPlanPrices("prod_starter"), PlanSubscriptionUnavailable);
  more = false;
  product = { id: "prod_starter", active: false };
  await assert.rejects(provider.getPlanPrices("prod_starter"), PlanSubscriptionUnavailable);
  product = { id: "prod_starter", deleted: true };
  await assert.rejects(provider.getPlanPrices("prod_starter"), PlanSubscriptionUnavailable);
  product = { id: "prod_starter", active: true };
  unavailable = true;
  await assert.rejects(provider.getPlanPrices("prod_starter"), (error: unknown): boolean => error instanceof PlanSubscriptionUnavailable && !error.message.includes("secret Stripe"));
});


test("Checkout diagnostics retain Stripe error details without request data or credentials", async (context: TestContext): Promise<void> => {
  const logs: unknown[] = [];
  context.mock.method(Logger.prototype, "error", (message: unknown): void => { logs.push(message); });
  const failure: Error = Object.assign(new Error("Invalid price sk_test_privatekey\nBearer tokenvalue cs_test_session_secret_private"), {
    type: "StripeInvalidRequestError", code: "resource_missing", param: "line_items[0][price]",
    requestId: "req_checkout", statusCode: 400,
    headers: { authorization: "sk_live_hidden" }, raw: { message: "private raw response" },
  });
  const client: Stripe = {
    checkout: { sessions: { create: async (): Promise<never> => { throw failure; } } },
  } as unknown as Stripe;
  const provider: StripeProvider = new StripeProvider(client);
  await assert.rejects(provider.createPlanCheckoutSession({
    customerId: "cus_private", prices: [{ id: "price_test", usageType: "licensed" }],
    idempotencyKey: "private-key", successUrl: "https://kumo.example/dashboard", cancelUrl: "https://kumo.example/plans",
  }), (error: unknown): boolean => error instanceof PlanSubscriptionUnavailable && error.message === "Unable to create the Checkout Session; retry with the same Idempotency-Key");
  assert.deepEqual(logs, [{
    event: "stripe.checkout.failed", message: "Invalid price [redacted] [redacted] [redacted]",
    type: "StripeInvalidRequestError", code: "resource_missing", param: "line_items[0][price]", requestId: "req_checkout", statusCode: 400,
  }]);
});
