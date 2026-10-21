import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { SubscriptionCheckUnavailable } from "@kumo/application";
import { Plan } from "@kumo/domain";
import { StripeProvider } from "../dist/stripe/provider.js";
import { InfraPlanRepository, type InfraPlan } from "../dist/db/repositories/plan.js";
import type { Repository } from "typeorm";

function subscription(id: string, status: string, products: readonly (string | { id: string })[], more: boolean = false): Stripe.Subscription {
  return {
    id, status, items: {
      data: products.map((product: string | { id: string }, index: number): unknown => ({ id: `${id}_item_${index}`, price: { product } })), has_more: more,
    },
  } as unknown as Stripe.Subscription;
}

test("Stripe adapter filters by active customer subscriptions and paginates subscriptions and nested items", async (): Promise<void> => {
  const queries: Stripe.SubscriptionListParams[] = [];
  const itemQueries: Stripe.SubscriptionItemListParams[] = [];
  const client: Stripe = {
    subscriptions: { list: async (params: Stripe.SubscriptionListParams): Promise<unknown> => {
      queries.push(params);
      return params.starting_after ? {
        data: [subscription("sub_2", "active", [{ id: "prod_expanded" }])], has_more: false,
      } : {
        data: [subscription("sub_1", "active", ["prod_cpu"], true)], has_more: true,
      };
    } },
    subscriptionItems: { list: async (params: Stripe.SubscriptionItemListParams): Promise<unknown> => {
      itemQueries.push(params);
      return { data: [{ id: "si_plan", price: { product: "prod_starter" } }], has_more: false };
    } },
  } as unknown as Stripe;
  const products: readonly string[] = await new StripeProvider(client).getActiveSubscriptionProductIds("cus_alice");
  assert.deepEqual(products, ["prod_cpu", "prod_starter", "prod_expanded"]);
  assert.deepEqual(queries, [
    { customer: "cus_alice", status: "active", limit: 100 },
    { customer: "cus_alice", status: "active", limit: 100, starting_after: "sub_1" },
  ]);
  assert.deepEqual(itemQueries, [{ subscription: "sub_1", limit: 100, starting_after: "sub_1_item_0" }]);
});

test("Stripe adapter does not grant eligibility for trialing, past_due or canceled subscriptions", async (): Promise<void> => {
  const client: Stripe = { subscriptions: { list: async (): Promise<unknown> => ({
    data: [subscription("sub_1", "trialing", ["prod_trial"]), subscription("sub_2", "past_due", ["prod_due"]), subscription("sub_3", "canceled", ["prod_canceled"])],
    has_more: false,
  }) } } as unknown as Stripe;
  assert.deepEqual(await new StripeProvider(client).getActiveSubscriptionProductIds("cus_alice"), []);
});

test("Stripe failures are sanitized and cannot look like an empty successful eligibility check", async (): Promise<void> => {
  const client: Stripe = { subscriptions: { list: async (): Promise<never> => { throw new Error("secret upstream payload"); } } } as unknown as Stripe;
  await assert.rejects(new StripeProvider(client).getActiveSubscriptionProductIds("cus_alice"), (error: unknown): boolean =>
    error instanceof SubscriptionCheckUnavailable && !error.message.includes("secret"));
});

test("plan lookup filters active Stripe product mappings and preserves quota fields", async (): Promise<void> => {
  let queries: number = 0;
  const repository: Repository<InfraPlan> = { findBy: async (where: unknown): Promise<InfraPlan[]> => {
    queries += 1;
    assert.equal((where as { active: boolean }).active, true);
    return [{ id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, disk: 10, deployments: 3, maxReplicas: 4, active: true, stripeProductId: "prod_starter" }];
  } } as unknown as Repository<InfraPlan>;
  const adapter: InfraPlanRepository = new InfraPlanRepository(repository);
  assert.deepEqual(await adapter.findActiveByStripeProductIds([]), []);
  assert.equal(queries, 0);
  const plans: Plan[] = await adapter.findActiveByStripeProductIds(["prod_starter"]);
  assert.equal(plans[0]!.stripeProductId, "prod_starter");
  assert.equal(plans[0]!.maxReplicas, 4);
});

test("plan construction validates Stripe product IDs and positive integer replica limits", (): void => {
  const details: { id: string; name: string; price: number; vcpu: number; memory: number; deployments: number; disk: number } =
    { id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 3, disk: 10 };
  assert.equal(new Plan(details).maxReplicas, 1);
  assert.equal(new Plan(details).stripeProductId, null);
  assert.throws((): Plan => new Plan({ ...details, stripeProductId: "price_wrong" }));
  assert.throws((): Plan => new Plan({ ...details, maxReplicas: 0 }));
  assert.throws((): Plan => new Plan({ ...details, maxReplicas: 1.5 }));
});
