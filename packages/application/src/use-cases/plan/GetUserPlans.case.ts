import type { Plan, User } from "@kumo/domain";
import type { UserRepository } from "../../ports/user.js";
import type { PlanRepository } from "../../ports/plan.js";
import { SubscriptionCheckUnavailable, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import { PlanSubscriptionForbidden } from "../../ports/plan-subscription.js";

export class GetUserPlansCase {
  public constructor(
    private readonly users: Pick<UserRepository, "findById">,
    private readonly plans: PlanRepository,
    private readonly subscriptions: StripeSubscriptionGateway,
  ) {}

  public async exec(userId: string): Promise<Plan[]> {
    const user: User | null = await this.users.findById(userId);
    if (!user?.active || user.suspended) throw new PlanSubscriptionForbidden("An active, unsuspended user is required");
    if (!user.stripeCustomerId) return [];
    let products: readonly string[];
    try {
      products = await this.subscriptions.getActiveSubscriptionProductIds(user.stripeCustomerId);
    } catch {
      throw new SubscriptionCheckUnavailable("Unable to verify the current plan; retry later");
    }
    if (products.length === 0) return [];
    return this.plans.findActiveByStripeProductIds(products);
  }
}
