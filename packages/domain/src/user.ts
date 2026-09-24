import { Domain, InvalidDomainParams } from "./index.js";
import { isBlankStr } from "./utils.js";

export class User extends Domain<UserDetails> {
  public readonly id: string;
  public readonly displayName: string;
  public readonly createdAt: Date;
  public readonly suspended: boolean;

  public constructor(details: UserDetails) {
    super(details);

    this.id = details.id;
    this.displayName = details.displayName;
    this.createdAt = details.createdAt ?? new Date();
    this.suspended = details.suspended;
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) { 
      return new InvalidDomainParams(`User.id must not be blank`);
    }

    if (isBlankStr(this.details.displayName)) {
      return new InvalidDomainParams(`User.displayName must not be blank`);
    }

    return null;
  }
}

export interface UserDetails {
  id: string;
  displayName: string;
  hashedPassword: string;
  createdAt?: Date;
  suspended: boolean;
}
