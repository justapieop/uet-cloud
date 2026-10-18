import type { Subscription } from "@kumo/domain";
import { SubscriptionInactive, type SubscriptionRepository } from "../../ports/subscription.js";
import { requireId } from "./helpers.js";

export class EnsureActiveSubscriptionCase {
  public constructor(private readonly repository: SubscriptionRepository) {}

  public async exec(userId: string): Promise<void> {
    requireId(userId, "Subscription.userId");
    const subscriptions: Subscription[] = await this.repository.findByUserId(userId, { active: true });
    if (!subscriptions.some((subscription: Subscription): boolean => subscription.userId === userId && subscription.active)) {
      throw new SubscriptionInactive("An active plan subscription is required");
    }
  }
}
