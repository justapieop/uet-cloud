export interface PlanSubscriptionResult {
  readonly checkoutSessionId: string;
  readonly checkoutUrl: string;
}

export interface PlanCheckoutRedirects {
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface PlanSubscriptionGateway {
  /** Resolve only the product's configured default price; never select another active price. */
  getPlanDefaultPriceId(productId: string): Promise<string>;
  createPlanCheckoutSession(input: PlanCheckoutRedirects & {
    customerId: string; priceId: string; idempotencyKey: string;
  }): Promise<PlanSubscriptionResult>;
}

export class InvalidPlanSubscription extends Error {}
export class PlanSubscriptionForbidden extends Error {}
export class SubscriptionPlanNotFound extends Error {}
export class PlanSubscriptionConflict extends Error {}
export class PlanSubscriptionUnavailable extends Error {}
