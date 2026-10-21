import type { StripeCustomerGateway } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import type Stripe from "stripe";

@Injectable()
export class StripeProvider implements StripeCustomerGateway {
  public constructor(private readonly client: Stripe) { }

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
