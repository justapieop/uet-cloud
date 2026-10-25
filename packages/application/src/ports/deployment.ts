import type { Deployment, DeploymentSpec, DeploymentStatus } from "@kumo/domain";

export interface DeploymentListFilters {
  readonly status?: DeploymentStatus;
  readonly name?: string;
  readonly region?: string;
}

export interface DeploymentRepository {
  findById(id: string): Promise<Deployment | null>;
  findByIdAndUserId(id: string, userId: string): Promise<Deployment | null>;
  findByUserId(userId: string, filters?: DeploymentListFilters): Promise<Deployment[]>;
  save(deployment: Deployment): Promise<void>;
  insert(deployment: Deployment): Promise<void>;
  countReservedByUserId(userId: string): Promise<number>;
  update(deployment: Deployment): Promise<void>;
  updateProgress(deployment: Deployment): Promise<void>;
  transitionStatus(id: string, userId: string, from: DeploymentStatus, to: DeploymentStatus): Promise<boolean>;
  delete(deploymentId: string, userId: string): Promise<void>;
}

export const DEPLOYMENT_REPOSITORY: symbol = Symbol("DEPLOYMENT_REPOSITORY");

export interface DeploymentQueueRepository extends DeploymentRepository {
  claimNextPending(): Promise<Deployment | null>;
  failStaleProvisioning(before: Date): Promise<void>;
}

export interface DeploymentProvisionInput {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly spec: DeploymentSpec;
  readonly resourceId?: string;
}

export interface DeploymentProvisionResult {
  readonly buildId: string;
  readonly image: string;
  readonly resourceId: string;
  readonly fqdn: string | null;
}

export interface DeploymentProvisioner {
  provisionDeployment(input: DeploymentProvisionInput, onBuildAccepted: (id: string, image: string) => Promise<void>): Promise<DeploymentProvisionResult>;
}

export class DeploymentAlreadyExists extends Error {}
export class DeploymentNotFoundError extends Error {}
