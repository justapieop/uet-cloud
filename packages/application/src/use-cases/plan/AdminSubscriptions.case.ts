import { createHash } from "node:crypto";
import { InvalidDomainParams, type User } from "@kumo/domain";
import type { UserRepository } from "../../ports/user.js";
import { AdminBillingNotFound, type AdminSubscription, type AdminSubscriptionGateway, type AdminSubscriptionPage } from "../../ports/admin-billing.js";

export class AdminSubscriptionsCase {
  public constructor(private readonly users: Pick<UserRepository, "findById">, private readonly stripe: AdminSubscriptionGateway) {}

  private async customer(userId: string): Promise<string | null> {
    const user: User | null = await this.users.findById(userId);
    if (!user) throw new AdminBillingNotFound("User not found");
    return user.stripeCustomerId;
  }

  public async list(userId: string, limit: number, cursor?: string): Promise<AdminSubscriptionPage> {
    const customerId: string | null = await this.customer(userId);
    return customerId ? this.stripe.listCustomerSubscriptions(customerId, limit, cursor) : { subscriptions: [], hasMore: false, nextCursor: null };
  }

  public async setCancellation(input: { actorId: string; userId: string; subscriptionId: string; cancelAtPeriodEnd: boolean; key?: string }): Promise<AdminSubscription> {
    if (!input.key || !/^[\x21-\x7e][\x20-\x7e]{0,254}$/.test(input.key)) throw new InvalidDomainParams("A valid Idempotency-Key is required");
    const customerId: string | null = await this.customer(input.userId);
    if (!customerId) throw new AdminBillingNotFound("Subscription not found for this user");
    const key: string = createHash("sha256").update(JSON.stringify(["admin.subscription.cancellation", input.actorId, input.userId, input.subscriptionId, input.key])).digest("hex");
    return this.stripe.setSubscriptionCancellation(customerId, input.subscriptionId, input.cancelAtPeriodEnd, `kumo-admin-${key}`);
  }
}
