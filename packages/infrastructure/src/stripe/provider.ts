import { SubscriptionCheckUnavailable, type StripeCustomerGateway, type StripeSubscriptionGateway } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import type Stripe from "stripe";

@Injectable()
export class StripeProvider implements StripeCustomerGateway, StripeSubscriptionGateway {
  public constructor(private readonly client: Stripe) { }

  public async getActiveSubscriptionProductIds(customerId: string): Promise<readonly string[]> {
    const products: Set<string> = new Set<string>();
    let cursor: string | undefined;
    try {
      while (true) {
        const page: Stripe.ApiList<Stripe.Subscription> = await this.client.subscriptions.list({
          customer: customerId, status: "active", limit: 100, ...(cursor ? { starting_after: cursor } : {}),
        });
        for (let index: number = 0; index < page.data.length; index += 1) {
          const subscription: Stripe.Subscription = page.data[index]!;
          if (subscription.status !== "active") continue;
          let items: Stripe.ApiList<Stripe.SubscriptionItem> = subscription.items;
          while (true) {
            for (let itemIndex: number = 0; itemIndex < items.data.length; itemIndex += 1) {
              const product: Stripe.Price["product"] = items.data[itemIndex]!.price.product;
              products.add(typeof product === "string" ? product : product.id);
            }
            if (!items.has_more) break;
            const lastItem: Stripe.SubscriptionItem | undefined = items.data.at(-1);
            if (!lastItem) throw new Error("Invalid Stripe item pagination");
            items = await this.client.subscriptionItems.list({ subscription: subscription.id, limit: 100, starting_after: lastItem.id });
          }
        }
        if (!page.has_more) break;
        cursor = page.data.at(-1)?.id;
        if (!cursor) throw new Error("Invalid Stripe subscription pagination");
      }
      return [...products];
    } catch {
      throw new SubscriptionCheckUnavailable("Unable to verify the active subscription; retry later");
    }
  }

  public async createCustomer(
    userId: string,
    idempotencyKey: string,
  ): Promise<Stripe.Response<Stripe.Customer>> {
    return this.client.customers.create(
      { metadata: { kumoId: userId, }, },
      { idempotencyKey, }
    );
  }

  public async getProducts(
    params: Stripe.ProductListParams = {},
  ): Promise<Stripe.Response<Stripe.ApiList<Stripe.Product>>> {
    return this.client.products.list({ active: true, limit: 100, ...params });
  }

  public async getPrices(
    productId: string,
    params: Omit<Stripe.PriceListParams, "product" | "type"> = {},
  ): Promise<Stripe.Response<Stripe.ApiList<Stripe.Price>>> {
    return this.client.prices.list({ active: true, limit: 100, ...params, product: productId, type: "recurring" });
  }

  public async getSubscriptions(
    customerId: string,
    params: Omit<Stripe.SubscriptionListParams, "customer"> = {},
  ): Promise<Stripe.Response<Stripe.ApiList<Stripe.Subscription>>> {
    return this.client.subscriptions.list({ status: "all", limit: 100, ...params, customer: customerId });
  }

  public async subscribeTo(
    customerId: string,
    priceId: string,
    idempotencyKey: string,
  ): Promise<Stripe.Response<Stripe.Subscription>> {
    return this.client.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.confirmation_secret"],
      },
      {
        idempotencyKey,
      }
    );
  }
}
