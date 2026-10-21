import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export class User extends Domain<UserDetails> {
  public readonly id: string;
  public readonly displayName: string;
  public readonly createdAt: Date;
  public readonly suspended: boolean;
  public readonly stripeCustomerId: string | null;

  public constructor(details: UserDetails) {
    super(details);

    this.id = details.id;
    this.displayName = details.displayName;
    this.createdAt = details.createdAt ?? new Date();
    this.suspended = details.suspended;
    this.stripeCustomerId = details.stripeCustomerId ?? null;
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) { 
      return new InvalidDomainParams(`User.id must not be blank`);
    }

    if (isBlankStr(this.details.displayName)) {
      return new InvalidDomainParams(`User.displayName must not be blank`);
    }

    if (this.details.stripeCustomerId != null &&
      (typeof this.details.stripeCustomerId !== "string" || !/^cus_[A-Za-z0-9]+$/.test(this.details.stripeCustomerId) || this.details.stripeCustomerId.length > 255)) {
      return new InvalidDomainParams("User.stripeCustomerId must be a Stripe Customer ID or null");
    }

    return null;
  }
}

export interface UserDetails {
  id: string;
  displayName: string;
  createdAt?: Date;
  suspended: boolean;
  stripeCustomerId?: string | null;
}
