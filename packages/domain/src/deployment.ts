import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

const ACA_NAME_REGEX: RegExp = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

export type DeploymentStatus =
  | "PENDING"
  | "RUNNING"
  | "FAILED"
  | "STOPPED"
  | "DELETING"
  | "DELETED";

export interface ContainerResources {
  cpu?: number;
  memory?: number;
}

export interface ContainerScaling {
  minReplicas?: number;
  maxReplicas?: number;
}

export interface DeploymentSpec {
  image: string;
  targetPort: number;
  resources?: ContainerResources;
  scaling?: ContainerScaling;
  envVars?: Record<string, string> | null;
}

export interface DeploymentDetails {
  id: string;
  userId: string;
  name: string;
  status: DeploymentStatus;
  spec: DeploymentSpec;
  fqdn?: string | null;
  errorMessage?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Deployment extends Domain<DeploymentDetails> {
  public readonly id: string;
  public readonly userId: string;
  public readonly name: string;
  public readonly status: DeploymentStatus;
  public readonly spec: DeploymentSpec;
  public readonly fqdn: string | null;
  public readonly errorMessage: string | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  public constructor(details: DeploymentDetails) {
    super(details);

    this.id = details.id;
    this.userId = details.userId;
    this.name = details.name;
    this.status = details.status;
    this.spec = {
      image: details.spec.image,
      targetPort: details.spec.targetPort,
      resources: {
        cpu: details.spec.resources?.cpu ?? 0.25,
        memory: details.spec.resources?.memory ?? 0.5,
      },
      scaling: {
        minReplicas: details.spec.scaling?.minReplicas ?? 0,
        maxReplicas: details.spec.scaling?.maxReplicas ?? 2,
      },
      envVars: details.spec.envVars ?? null,
    };
    this.fqdn = details.fqdn ?? null;
    this.errorMessage = details.errorMessage ?? null;
    this.createdAt = details.createdAt ?? new Date();
    this.updatedAt = details.updatedAt ?? new Date();
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) {
      return new InvalidDomainParams("Deployment.id must not be blank");
    }

    if (isBlankStr(this.details.userId)) {
      return new InvalidDomainParams("Deployment.userId must not be blank");
    }

    if (!ACA_NAME_REGEX.test(this.details.name)) {
      return new InvalidDomainParams(
        "Deployment.name must be 2-32 characters, lowercase alphanumeric or hyphens, starting with a letter and ending with alphanumeric",
      );
    }

    if (!this.details.spec) {
      return new InvalidDomainParams("Deployment.spec must be defined");
    }

    if (isBlankStr(this.details.spec.image)) {
      return new InvalidDomainParams("Deployment.spec.image must not be blank");
    }

    if (
      !Number.isInteger(this.details.spec.targetPort) ||
      this.details.spec.targetPort < 1 ||
      this.details.spec.targetPort > 65535
    ) {
      return new InvalidDomainParams(
        "Deployment.spec.targetPort must be an integer between 1 and 65535",
      );
    }

    const minReplicas: number = this.details.spec.scaling?.minReplicas ?? 0;
    if (!Number.isInteger(minReplicas) || minReplicas < 0) {
      return new InvalidDomainParams(
        "Deployment.spec.scaling.minReplicas must be a non-negative integer",
      );
    }

    const maxReplicas: number = this.details.spec.scaling?.maxReplicas ?? 2;
    if (!Number.isInteger(maxReplicas) || maxReplicas < minReplicas) {
      return new InvalidDomainParams(
        "Deployment.spec.scaling.maxReplicas must be an integer greater than or equal to minReplicas",
      );
    }

    return null;
  }
}
