import { Domain, InvalidDomainParams } from "./domain.js";

export interface DeploymentResourceConfigurationDetails {
  readonly maxVcpu: number;
  readonly maxMemory: number;
  readonly minScaling: number;
  readonly maxScaling: number;
}

export function validateDeploymentResourceConfiguration(details: DeploymentResourceConfigurationDetails): InvalidDomainParams | null {
  if (!details || !Number.isFinite(details.maxVcpu) || details.maxVcpu <= 0 || !Number.isInteger(details.maxVcpu * 4) ||
    !Number.isFinite(details.maxMemory) || details.maxMemory !== details.maxVcpu * 2) {
    return new InvalidDomainParams("Memory in GiB must be exactly twice vCPU; vCPU must be positive in increments of 0.25");
  }
  if (!Number.isInteger(details.minScaling) || details.minScaling < 0 || !Number.isInteger(details.maxScaling) ||
    details.maxScaling < 1 || details.minScaling > details.maxScaling) {
    return new InvalidDomainParams("Scaling must use integer replica counts with 0 <= min_scaling <= max_scaling and max_scaling >= 1");
  }
  return null;
}

export class DeploymentResourceConfiguration extends Domain<DeploymentResourceConfigurationDetails> {
  public constructor(details: DeploymentResourceConfigurationDetails) { super(details); }
  public validate(): InvalidDomainParams | null { return validateDeploymentResourceConfiguration(this.details); }
  public get maxVcpu(): number { return this.details.maxVcpu; }
  public get maxMemory(): number { return this.details.maxMemory; }
  public get minScaling(): number { return this.details.minScaling; }
  public get maxScaling(): number { return this.details.maxScaling; }
  public getDetails(): DeploymentResourceConfigurationDetails { return { ...this.details }; }
  public equals(other: DeploymentResourceConfigurationDetails): boolean {
    return this.maxVcpu === other.maxVcpu && this.maxMemory === other.maxMemory && this.minScaling === other.minScaling && this.maxScaling === other.maxScaling;
  }
}

export interface DeploymentResourceBaseline {
  readonly configuration: DeploymentResourceConfigurationDetails;
  readonly version: string;
  readonly image: string;
  readonly mainContainerName: string;
  readonly revisionName: string;
  readonly resourceId: string;
  readonly environmentId: string;
  readonly revisionMode: "Single";
  readonly runningStatus: "Running" | "Stopped";
}
