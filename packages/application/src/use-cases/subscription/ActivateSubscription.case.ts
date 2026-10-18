import type { Subscription } from "@kumo/domain";
import type { SubscriptionRepositories, SubscriptionUnitOfWork } from "../../ports/subscription.js";
import { copySubscription, getOwnedSubscription, requireAvailablePlan, type OwnedSubscriptionInput } from "./helpers.js";

export type ActivateSubscriptionInput = OwnedSubscriptionInput;

export class ActivateSubscriptionCase {
  public constructor(private readonly unitOfWork: SubscriptionUnitOfWork) {}

  public exec(input: ActivateSubscriptionInput): Promise<Subscription> {
    return this.unitOfWork.run(async (repositories: SubscriptionRepositories): Promise<Subscription> => {
      const current: Subscription = await getOwnedSubscription(repositories.subscriptions, input);
      if (current.active) return current;
      await requireAvailablePlan(repositories.plans, current.planId);
      const updated: Subscription = copySubscription(current, { active: true });
      await repositories.subscriptions.update(updated);
      return updated;
    });
  }
}
