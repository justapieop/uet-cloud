import { createHash } from "node:crypto";
import type { Plan, User } from "@kumo/domain";
import type { UserRepository } from "../../ports/user.js";
import type { PlanReader } from "../../ports/plan.js";
import { InvalidPlanSubscription, PlanSubscriptionForbidden, SubscriptionPlanNotFound, type PlanCheckoutRedirects, type PlanSubscriptionGateway, type PlanSubscriptionPrice, type PlanSubscriptionResult } from "../../ports/plan-subscription.js";

export class SubscribeToPlanCase {
  public constructor(
    private readonly users: Pick<UserRepository, "findById">,
    private readonly plans: PlanReader,
    private readonly subscriptions: PlanSubscriptionGateway,
    private readonly redirects: PlanCheckoutRedirects,
  ) {}

  public async exec(input: { userId: string; planId: string; idempotencyKey?: string }): Promise<PlanSubscriptionResult> {
    if (!input.idempotencyKey || !/^[\x21-\x7e][\x20-\x7e]{0,254}$/.test(input.idempotencyKey) ||
      !input.planId.trim() || input.planId.length > 255) {
      throw new InvalidPlanSubscription("A valid plan and Idempotency-Key are required");
    }
    const user: User | null = await this.users.findById(input.userId);
    if (!user || !user.active || user.suspended) throw new PlanSubscriptionForbidden("An active, unsuspended user is required");
    if (!user.stripeCustomerId) throw new PlanSubscriptionForbidden("Complete GitHub login to link a Stripe customer before subscribing");
    const plan: Plan | null = await this.plans.findById(input.planId);
    if (!plan?.active || !plan.stripeProductId) throw new SubscriptionPlanNotFound("An active Stripe-linked plan was not found");
    const prices: readonly PlanSubscriptionPrice[] = await this.subscriptions.getPlanPrices(plan.stripeProductId);
    // Scope by the authenticated owner, not by price: Stripe rejects changed parameters on a retry.
    const key: string = createHash("sha256").update(JSON.stringify(["plan.checkout", user.id, input.idempotencyKey])).digest("hex");
    return this.subscriptions.createPlanCheckoutSession({
      customerId: user.stripeCustomerId, prices, idempotencyKey: `kumo-checkout-${key}`,
      ...this.redirects,
    });
  }
}
