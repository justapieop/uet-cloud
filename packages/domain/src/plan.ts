import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export class Plan extends Domain<PlanDetails> {
  public readonly id!: string;
  public readonly name!: string;
  public readonly price!: number;
  public readonly vcpu!: number;
  public readonly memory!: number;
  public readonly deployments!: number;
  public readonly disk!: number;
  public readonly active: boolean;

  public constructor(
    details: PlanDetails,
  ) {
    super(details);

    this.id = details.id;
    this.name = details.name;
    this.price = details.price;
    this.vcpu = details.vcpu;
    this.memory = details.memory;
    this.deployments = details.deployments;
    this.disk = details.disk;
    this.active = details.active ?? true;
  }

  public validate(): InvalidDomainParams | null {
    if (this.details.active !== undefined && typeof this.details.active !== "boolean") {
      return new InvalidDomainParams("Plan.active must be a boolean");
    }
    if (isBlankStr(this.details.id)) {
      return new InvalidDomainParams("Plan.id must be not be blank");
    }

    if (isBlankStr(this.details.name)) {
      return new InvalidDomainParams("Plan.name must not be blank");
    }

    if (!Number.isFinite(this.details.price) || this.details.price < 0) {
      return new InvalidDomainParams("Plan.price must be a nonnegative finite number");
    }

    if (!Number.isFinite(this.details.vcpu) || this.details.vcpu <= 0) {
      return new InvalidDomainParams("Plan.vcpu must be a positive number");
    }

    if (!Number.isFinite(this.details.memory) || this.details.memory <= 0 || this.details.memory / 2 !== this.details.vcpu) {
      return new InvalidDomainParams("Plan.memory must be a positive number that 2x the amount of vcpu");
    }

    if (!Number.isInteger(this.details.deployments) || this.details.deployments <= 0) {
      return new InvalidDomainParams("Plan.deployments must be a positive integer");
    }

    if (!Number.isInteger(this.details.disk) || this.details.disk <= 0) {
      return new InvalidDomainParams("Plan.disk must be a positive integer");
    }

    return null;
  }
}

export interface PlanDetails {
  id: string;
  name: string;
  price: number;
  vcpu: number;
  memory: number;
  deployments: number;
  disk: number;
  active?: boolean;
}
