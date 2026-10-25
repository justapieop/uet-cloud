import type { Plan } from "@kumo/domain";

export interface AdminPlanRepository {
  list(page: number, perPage: number): Promise<Plan[]>;
  findById(id: string): Promise<Plan | null>;
  insert(plan: Plan): Promise<void>;
  replace(plan: Plan): Promise<void>;
  deactivate(id: string): Promise<void>;
}

export interface AdminSubscription {
  readonly id: string;
  readonly status: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: number | null;
  readonly items: readonly { priceId: string; productId: string }[];
}

export interface AdminSubscriptionPage {
  readonly subscriptions: readonly AdminSubscription[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface AdminSubscriptionGateway {
  listCustomerSubscriptions(customerId: string, limit: number, cursor?: string): Promise<AdminSubscriptionPage>;
  setSubscriptionCancellation(customerId: string, subscriptionId: string, cancelAtPeriodEnd: boolean, key: string): Promise<AdminSubscription>;
}

export class AdminBillingNotFound extends Error {}
export class AdminBillingConflict extends Error {}
export class AdminBillingUnavailable extends Error {}
