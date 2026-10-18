import { InvalidDomainParams, Subscription, type Plan } from "@kumo/domain";
import {
  SubscriptionNotFound, SubscriptionPlanInactive, SubscriptionPlanNotFound,
  type SubscriptionPlanReader, type SubscriptionRepository,
} from "../../ports/subscription.js";

export interface OwnedSubscriptionInput {
  readonly id: string;
  readonly userId: string;
}

export function requireId(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) throw new InvalidDomainParams(`${field} must not be blank`);
}

export async function getOwnedSubscription(repository: SubscriptionRepository, input: OwnedSubscriptionInput): Promise<Subscription> {
  requireId(input.id, "Subscription.id");
  requireId(input.userId, "Subscription.userId");
  const subscription: Subscription | null = await repository.findByIdAndUserId(input.id, input.userId);
  if (!subscription || subscription.id !== input.id || subscription.userId !== input.userId) {
    throw new SubscriptionNotFound("Subscription was not found for this user");
  }
  return subscription;
}

export async function requireAvailablePlan(reader: SubscriptionPlanReader, planId: string): Promise<void> {
  requireId(planId, "Subscription.planId");
  const plan: Plan | null = await reader.findById(planId);
  if (!plan) throw new SubscriptionPlanNotFound("Plan was not found");
  if (!plan.active) throw new SubscriptionPlanInactive("Plan is not available for subscription");
}

export function copySubscription(subscription: Subscription, changes: { readonly planId?: string; readonly active?: boolean }): Subscription {
  return new Subscription({
    id: subscription.id, userId: subscription.userId, planId: changes.planId ?? subscription.planId,
    active: changes.active ?? subscription.active, createdAt: subscription.createdAt,
  });
}
