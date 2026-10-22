import type { Plan } from "@kumo/domain";

export interface PlanRepository {
  findActiveByStripeProductIds(productIds: readonly string[]): Promise<Plan[]>;
}

export interface PlanReader {
  findById(id: string): Promise<Plan | null>;
}

export interface PlanCatalogReader {
  /** Active plans mapped to Stripe, ordered by local price then ID. */
  findAvailable(): Promise<Plan[]>;
}
