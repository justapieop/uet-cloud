import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { AdminBillingNotFound, AdminBillingUnavailable, type AdminSubscriptionPage } from "@kumo/application";
import { StripeProvider } from "../dist/stripe/provider.js";

test("admin subscription changes verify customer ownership and preserve all price items", async (): Promise<void> => {
  let owner: string = "cus_alice";
  let updates: number = 0;
  const subscription: () => object = (): object => ({ id: "sub_alice", status: "active", customer: owner, cancel_at_period_end: false, cancel_at: null,
    items: { data: [{ id: "si_base", price: { id: "price_base", product: "prod_starter" } }], has_more: true } });
  const client: Stripe = {
    subscriptions: {
      retrieve: async (id: string): Promise<object> => { assert.equal(id, "sub_alice"); return subscription(); },
      update: async (id: string, params: Stripe.SubscriptionUpdateParams, options: Stripe.RequestOptions): Promise<object> => {
        updates++; assert.equal(id, "sub_alice"); assert.deepEqual(params, { cancel_at_period_end: true }); assert.equal(options.idempotencyKey, "key");
        return { ...subscription(), cancel_at_period_end: true };
      },
      list: async (params: Stripe.SubscriptionListParams): Promise<object> => {
        assert.deepEqual(params, { customer: "cus_alice", status: "all", limit: 10, starting_after: "sub_previous" });
        return { data: [subscription()], has_more: true };
      },
    },
    subscriptionItems: { list: async (params: Stripe.SubscriptionItemListParams): Promise<object> => {
      assert.deepEqual(params, { subscription: "sub_alice", starting_after: "si_base", limit: 100 });
      return { data: [{ id: "si_cpu", price: { id: "price_cpu", product: { id: "prod_starter" } } }], has_more: false };
    } },
  } as unknown as Stripe;
  const provider: StripeProvider = new StripeProvider(client);
  owner = "cus_victim";
  await assert.rejects(provider.setSubscriptionCancellation("cus_alice", "sub_alice", true, "key"), AdminBillingNotFound);
  assert.equal(updates, 0);
  owner = "cus_alice";
  const updated: Awaited<ReturnType<StripeProvider["setSubscriptionCancellation"]>> = await provider.setSubscriptionCancellation("cus_alice", "sub_alice", true, "key");
  assert.equal(updated.cancelAtPeriodEnd, true); assert.equal(updated.items.length, 2); assert.equal(updates, 1);
  const list: AdminSubscriptionPage = await provider.listCustomerSubscriptions("cus_alice", 10, "sub_previous");
  assert.equal(list.hasMore, true); assert.equal(list.nextCursor, "sub_alice"); assert.equal(list.subscriptions[0]?.items.length, 2);
  owner = "cus_victim";
  await assert.rejects(provider.listCustomerSubscriptions("cus_alice", 10, "sub_previous"), AdminBillingUnavailable);
});
