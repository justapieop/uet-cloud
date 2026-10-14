import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export class Deployment extends Domain<DeploymentDetails> {
  public readonly id: string;
  public readonly userId: string;
  public readonly name: string;
  public readonly createdAt: Date;

  public constructor(details: DeploymentDetails) {
    super(details);

    this.id = details.id;
    this.userId = details.userId;
    this.name = details.name;
    this.createdAt = details.createdAt ?? new Date();
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) { 
      return new InvalidDomainParams("Deployment.id must not be blank");
    }

    if (isBlankStr(this.details.userId)) {
      return new InvalidDomainParams("Deployment.userId must not be blank");
    }

    if (isBlankStr(this.details.name) || this.details.name.length > 32) {
      return new InvalidDomainParams("Deployment.name must be in between 1 and 32 characters");
    }

    return null;
  }
}

export interface DeploymentDetails {
  id: string;
  userId: string;
  name: string;
  createdAt?: Date;
}