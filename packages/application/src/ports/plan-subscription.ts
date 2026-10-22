export interface PlanSubscriptionResult {
  readonly checkoutSessionId: string;
  readonly checkoutUrl: string;
}

export interface PlanCheckoutRedirects {
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface PlanSubscriptionGateway {
  /** Resolve all active prices for the linked product, across all pages. */
  getPlanPrices(productId: string): Promise<readonly PlanSubscriptionPrice[]>;
  createPlanCheckoutSession(input: PlanCheckoutRedirects & {
    customerId: string; prices: readonly PlanSubscriptionPrice[]; idempotencyKey: string;
  }): Promise<PlanSubscriptionResult>;
}

export interface PlanSubscriptionPrice {
  readonly id: string;
  readonly usageType: "licensed" | "metered" | "one_time";
}

export class InvalidPlanSubscription extends Error {}
export class PlanSubscriptionForbidden extends Error {}
export class SubscriptionPlanNotFound extends Error {}
export class PlanSubscriptionConflict extends Error {}
export class PlanSubscriptionUnavailable extends Error {}
