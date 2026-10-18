import type { Subscription } from "@kumo/domain";
import type { SubscriptionRepositories, SubscriptionUnitOfWork } from "../../ports/subscription.js";
import { copySubscription, getOwnedSubscription, type OwnedSubscriptionInput } from "./helpers.js";

export type DeactivateSubscriptionInput = OwnedSubscriptionInput;

export class DeactivateSubscriptionCase {
  public constructor(private readonly unitOfWork: SubscriptionUnitOfWork) {}

  public exec(input: DeactivateSubscriptionInput): Promise<Subscription> {
    return this.unitOfWork.run(async (repositories: SubscriptionRepositories): Promise<Subscription> => {
      const current: Subscription = await getOwnedSubscription(repositories.subscriptions, input);
      if (!current.active) return current;
      const updated: Subscription = copySubscription(current, { active: false });
      await repositories.subscriptions.update(updated);
      return updated;
    });
  }
}
