import type { User } from "@kumo/domain";

export interface StripeCustomerGateway {
  createCustomer(userId: string, idempotencyKey: string): Promise<{ readonly id: string }>;
}

export type StripeCustomerLinkClaim =
  | { readonly state: "linked"; readonly user: User }
  | { readonly state: "busy" }
  | { readonly state: "create"; readonly idempotencyKey: string };

/** Claims and completions are atomic; Stripe requests run outside these transactions. */
export interface StripeCustomerLinkRepository {
  claim(userId: string, owner: string): Promise<StripeCustomerLinkClaim>;
  complete(userId: string, owner: string, customerId: string): Promise<User>;
  release(userId: string, owner: string): Promise<void>;
}

export class StripeCustomerLinkInProgress extends Error {}
export class StripeCustomerLinkReconciliationRequired extends Error {}
