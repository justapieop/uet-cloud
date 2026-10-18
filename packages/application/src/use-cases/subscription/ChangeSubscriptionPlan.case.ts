import type { Subscription } from "@kumo/domain";
import type { SubscriptionRepositories, SubscriptionUnitOfWork } from "../../ports/subscription.js";
import { copySubscription, getOwnedSubscription, requireAvailablePlan, requireId, type OwnedSubscriptionInput } from "./helpers.js";

export interface ChangeSubscriptionPlanInput extends OwnedSubscriptionInput {
  readonly planId: string;
}

export class ChangeSubscriptionPlanCase {
  public constructor(private readonly unitOfWork: SubscriptionUnitOfWork) {}

  public exec(input: ChangeSubscriptionPlanInput): Promise<Subscription> {
    requireId(input.planId, "Subscription.planId");
    return this.unitOfWork.run(async (repositories: SubscriptionRepositories): Promise<Subscription> => {
      const current: Subscription = await getOwnedSubscription(repositories.subscriptions, input);
      if (current.planId === input.planId) return current;
      await requireAvailablePlan(repositories.plans, input.planId);
      const updated: Subscription = copySubscription(current, { planId: input.planId });
      await repositories.subscriptions.update(updated);
      return updated;
    });
  }
}
