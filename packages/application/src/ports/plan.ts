import type { Plan } from "@kumo/domain";

export interface PlanRepository {
  findActiveByStripeProductIds(productIds: readonly string[]): Promise<Plan[]>;
}
