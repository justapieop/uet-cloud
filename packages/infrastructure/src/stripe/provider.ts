import { SubscriptionCheckUnavailable, type StripeCustomerGateway, type StripeSubscriptionGateway } from "@kumo/application";
import { Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { AdminBillingConflict, AdminBillingNotFound, AdminBillingUnavailable, type AdminSubscription, type AdminSubscriptionGateway, type AdminSubscriptionPage } from "@kumo/application";
import { PlanSubscriptionConflict, PlanSubscriptionUnavailable, type PlanCheckoutRedirects, type PlanSubscriptionGateway, type PlanSubscriptionPrice, type PlanSubscriptionResult } from "@kumo/application";

@Injectable()
export class StripeProvider implements StripeCustomerGateway, StripeSubscriptionGateway, PlanSubscriptionGateway, AdminSubscriptionGateway {
  private readonly logger: Logger = new Logger(StripeProvider.name);

  public constructor(private readonly client: Stripe) { }

  private async adminSubscription(subscription: Stripe.Subscription): Promise<AdminSubscription> {
    const prices: { priceId: string; productId: string }[] = [];
    const cursors: Set<string> = new Set();
    let page: Stripe.ApiList<Stripe.SubscriptionItem> = subscription.items;
    while (true) {
      prices.push(...page.data.map((item: Stripe.SubscriptionItem): { priceId: string; productId: string } => ({
        priceId: item.price.id, productId: typeof item.price.product === "string" ? item.price.product : item.price.product.id,
      })));
      if (!page.has_more) break;
      const cursor: string | undefined = page.data.at(-1)?.id;
      if (!cursor || cursors.has(cursor)) throw new Error("Invalid subscription item pagination");
      cursors.add(cursor);
      page = await this.client.subscriptionItems.list({ subscription: subscription.id, starting_after: cursor, limit: 100 });
    }
    return { id: subscription.id, status: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: subscription.cancel_at, items: prices };
  }

  private adminError(error: unknown): never {
    if (error instanceof AdminBillingNotFound) throw error;
    if (typeof error === "object" && error !== null) {
      if ("code" in error && error.code === "resource_missing") throw new AdminBillingNotFound("Subscription not found for this user");
      if (("type" in error && (error.type === "StripeIdempotencyError" || error.type === "StripeInvalidRequestError")) ||
        ("code" in error && error.code === "idempotency_key_in_use")) throw new AdminBillingConflict("Subscription update conflicts with its state or idempotency key");
    }
    throw new AdminBillingUnavailable("Stripe subscription management is unavailable; retry later");
  }

  public async listCustomerSubscriptions(customerId: string, limit: number, cursor?: string): Promise<AdminSubscriptionPage> {
    try {
      const page: Stripe.ApiList<Stripe.Subscription> = await this.client.subscriptions.list({ customer: customerId, status: "all", limit, ...(cursor ? { starting_after: cursor } : {}) });
      if (page.has_more && page.data.length === 0) throw new Error("Invalid subscription pagination");
      const subscriptions: AdminSubscription[] = [];
      for (let offset: number = 0; offset < page.data.length; offset += 5) {
        subscriptions.push(...await Promise.all(page.data.slice(offset, offset + 5).map((subscription: Stripe.Subscription): Promise<AdminSubscription> => {
          if ((typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id) !== customerId) throw new Error("Unexpected customer");
          return this.adminSubscription(subscription);
        })));
      }
      return { subscriptions,
        hasMore: page.has_more, nextCursor: page.has_more ? page.data.at(-1)?.id ?? null : null };
    } catch { throw new AdminBillingUnavailable("Unable to list Stripe subscriptions; retry later"); }
  }

  public async setSubscriptionCancellation(customerId: string, subscriptionId: string, cancelAtPeriodEnd: boolean, key: string): Promise<AdminSubscription> {
    try {
      const subscription: Stripe.Subscription = await this.client.subscriptions.retrieve(subscriptionId);
      const owner: string = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (owner !== customerId) throw new AdminBillingNotFound("Subscription not found for this user");
      const updated: Stripe.Subscription = await this.client.subscriptions.update(subscriptionId, { cancel_at_period_end: cancelAtPeriodEnd }, { idempotencyKey: key });
      return await this.adminSubscription(updated);
    } catch (error: unknown) { return this.adminError(error); }
  }

  public async getPlanPrices(productId: string): Promise<readonly PlanSubscriptionPrice[]> {
    try {
      const product: Stripe.Product | Stripe.DeletedProduct = await this.client.products.retrieve(productId);
      if (product.deleted || !product.active || product.id !== productId) throw new Error("Inactive plan product");
      const prices: Map<string, PlanSubscriptionPrice> = new Map();
      const cursors: Set<string> = new Set();
      let cursor: string | undefined;
      while (true) {
        const page: Stripe.ApiList<Stripe.Price> = await this.client.prices.list({
          product: productId, active: true, limit: 100, ...(cursor ? { starting_after: cursor } : {}),
        });
        for (let index: number = 0; index < page.data.length; index++) {
          const price: Stripe.Price = page.data[index]!;
          if (!price.active) continue;
          if ((typeof price.product === "string" ? price.product : price.product.id) !== productId) throw new Error("Foreign price");
          const usageType: unknown = price.type === "one_time" ? "one_time" : price.type === "recurring" ? price.recurring?.usage_type : undefined;
          if ((usageType !== "licensed" && usageType !== "metered" && usageType !== "one_time") || !price.id) throw new Error("Invalid price configuration");
          prices.set(price.id, { id: price.id, usageType });
        }
        if (!page.has_more) break;
        cursor = page.data.at(-1)?.id;
        if (!cursor || cursors.has(cursor)) throw new Error("Invalid price pagination");
        cursors.add(cursor);
      }
      // Stable ordering keeps Stripe idempotency parameters identical across list-order changes.
      const result: PlanSubscriptionPrice[] = [...prices.values()].sort((left: PlanSubscriptionPrice, right: PlanSubscriptionPrice): number => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const recurring: number = result.filter((price: PlanSubscriptionPrice): boolean => price.usageType !== "one_time").length;
      if (recurring < 1 || recurring > 20 || result.length - recurring > 20) throw new Error("Unsupported Checkout line item count");
      return result;
    } catch {
      throw new PlanSubscriptionUnavailable("Unable to resolve all plan prices; check Stripe product/pricing configuration and retry");
    }
  }

  public async createPlanCheckoutSession(input: PlanCheckoutRedirects & { customerId: string; prices: readonly PlanSubscriptionPrice[]; idempotencyKey: string }): Promise<PlanSubscriptionResult> {
    try {
      const session: Stripe.Checkout.Session = await this.client.checkout.sessions.create({
        mode: "subscription", ui_mode: "hosted_page", customer: input.customerId,
        line_items: input.prices.map((price: PlanSubscriptionPrice): Stripe.Checkout.SessionCreateParams.LineItem =>
          price.usageType === "metered" ? { price: price.id } : { price: price.id, quantity: 1 }),
        success_url: input.successUrl, cancel_url: input.cancelUrl,
      }, { idempotencyKey: input.idempotencyKey });
      if (!session.url) throw new Error("Stripe did not return an available Checkout URL");
      return { checkoutSessionId: session.id, checkoutUrl: session.url };
    } catch (error: unknown) {
      this.logCheckoutFailure(error);
      if (typeof error === "object" && error !== null &&
        (("type" in error && error.type === "StripeIdempotencyError") || ("code" in error && error.code === "idempotency_key_in_use"))) {
        throw new PlanSubscriptionConflict("Idempotency-Key is in use or was reused with different subscription parameters");
      }
      throw new PlanSubscriptionUnavailable("Unable to create the Checkout Session; retry with the same Idempotency-Key");
    }
  }

  private logCheckoutFailure(error: unknown): void {
    const details: Record<string, string | number> = { event: "stripe.checkout.failed" };
    if (typeof error === "object" && error !== null) {
      for (const field of ["message", "type", "code", "param", "requestId", "statusCode"]) {
        const value: unknown = (error as Record<string, unknown>)[field];
        if (typeof value === "string") {
          details[field] = value
            .replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9_]+|\bBearer\s+[^\s]+|[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+/gi, "[redacted]")
            .replace(/[\r\n\t]/g, " ").slice(0, 1000);
        } else if (typeof value === "number" && Number.isFinite(value)) {
          details[field] = value;
        }
      }
    }
    this.logger.error(details);
  }

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
