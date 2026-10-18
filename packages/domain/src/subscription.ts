import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export class Subscription extends Domain<SubscriptionDetails> {
  public readonly id: string;
  public readonly userId: string;
  public readonly planId: string;
  public readonly createdAt: Date;
  public readonly active: boolean;

  public constructor(details: SubscriptionDetails) {
    super(details);

    this.id = details.id;
    this.userId = details.userId;
    this.planId = details.planId;
    this.createdAt = details.createdAt ?? new Date();
    this.active = details.active;
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) {
      return new InvalidDomainParams("Subscription.id must be not be blank");
    }

    if (isBlankStr(this.details.userId)) {
      return new InvalidDomainParams("Subscription.userId must be not be blank");
    }

    if (isBlankStr(this.details.planId)) {
      return new InvalidDomainParams("Subscription.planId must be not be blank");
    }

    return null;
  }
}

export interface SubscriptionDetails {
  id: string;
  userId: string;
  planId: string;
  createdAt?: Date;
  active: boolean;
}