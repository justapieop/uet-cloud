import { InvalidDomainParams, type Subscription } from "@kumo/domain";
import type { SubscriptionListFilters, SubscriptionRepository } from "../../ports/subscription.js";
import { getOwnedSubscription, requireId } from "./helpers.js";

export class GetSubscriptionCase {
  public constructor(private readonly repository: SubscriptionRepository) {}

  public exec(id: string, userId: string): Promise<Subscription> {
    return getOwnedSubscription(this.repository, { id, userId });
  }

  public list(userId: string, filters: SubscriptionListFilters = {}): Promise<Subscription[]> {
    requireId(userId, "Subscription.userId");
    if (filters.active !== undefined && typeof filters.active !== "boolean") throw new InvalidDomainParams("Subscription active filter must be a boolean");
    if (filters.planId !== undefined) requireId(filters.planId, "Subscription.planId");
    return this.repository.findByUserId(userId, filters);
  }
}
