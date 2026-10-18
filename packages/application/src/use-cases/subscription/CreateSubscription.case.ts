import { randomUUID } from "node:crypto";
import { InvalidDomainParams, Subscription } from "@kumo/domain";
import { SubscriptionUserNotFound, type SubscriptionRepositories, type SubscriptionUnitOfWork } from "../../ports/subscription.js";
import { requireAvailablePlan, requireId } from "./helpers.js";

export interface CreateSubscriptionInput {
  readonly userId: string;
  readonly planId: string;
  readonly active: boolean;
}

export class CreateSubscriptionCase {
  public constructor(private readonly unitOfWork: SubscriptionUnitOfWork) {}

  public exec(input: CreateSubscriptionInput): Promise<Subscription> {
    requireId(input.userId, "Subscription.userId");
    requireId(input.planId, "Subscription.planId");
    if (typeof input.active !== "boolean") throw new InvalidDomainParams("Subscription.active must be a boolean");
    return this.unitOfWork.run(async (repositories: SubscriptionRepositories): Promise<Subscription> => {
      if (!await repositories.users.exists(input.userId)) throw new SubscriptionUserNotFound("User was not found");
      await requireAvailablePlan(repositories.plans, input.planId);
      const subscription: Subscription = new Subscription({
        id: randomUUID(), userId: input.userId, planId: input.planId, active: input.active, createdAt: new Date(),
      });
      await repositories.subscriptions.save(subscription);
      return subscription;
    });
  }
}
