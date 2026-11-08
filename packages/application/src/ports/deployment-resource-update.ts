import type { DeploymentResourceConfigurationDetails, DeploymentResourceUpdate, DeploymentResourceUpdateStatus } from "@kumo/domain";

export interface DeploymentResourceUpdateRepository {
  findByIdAndUserId(id: string, userId: string): Promise<DeploymentResourceUpdate | null>;
  findByKeyHash(keyHash: string): Promise<DeploymentResourceUpdate | null>;
  findLatestByDeployment(deploymentId: string, userId: string): Promise<DeploymentResourceUpdate | null>;
  insert(update: DeploymentResourceUpdate): Promise<void>;
}
export interface DeploymentResourceUpdateProgress {
  readonly operationId: string;
  readonly userId: string;
  readonly claimToken: string;
  readonly expectedStatus: DeploymentResourceUpdateStatus;
  readonly status: DeploymentResourceUpdateStatus;
  readonly targetRevision?: string | null;
  readonly observed?: DeploymentResourceConfigurationDetails | null;
  readonly noOp?: boolean | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly releaseClaim?: boolean;
  readonly retryAfterMs?: number;
}
export interface DeploymentResourceUpdateQueueRepository extends DeploymentResourceUpdateRepository {
  claimNext(): Promise<DeploymentResourceUpdate | null>;
  heartbeat(id: string, userId: string, claimToken: string): Promise<boolean>;
  updateClaimed(input: DeploymentResourceUpdateProgress): Promise<boolean>;
  recoverStaleClaims(): Promise<number>;
}
export const DEPLOYMENT_RESOURCE_UPDATE_REPOSITORY: symbol = Symbol("DEPLOYMENT_RESOURCE_UPDATE_REPOSITORY");
export const DEPLOYMENT_RESOURCE_UPDATE_QUEUE: symbol = Symbol("DEPLOYMENT_RESOURCE_UPDATE_QUEUE");

/** false means no write was submitted or a final failure has been verified; uncertain SDK outcomes must set true. */
export interface DeploymentResourceUpdateErrorContext {
  readonly observed?: DeploymentResourceConfigurationDetails | null;
  readonly targetRevision?: string | null;
}
export class DeploymentResourceUpdateError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly outcomeUnknown: boolean = false,
    public readonly context?: DeploymentResourceUpdateErrorContext,
  ) { super(message); }
}
export class DeploymentResourceUpdateNotFound extends Error {}
export class DeploymentResourceVersionRequired extends Error {}
export class DeploymentResourceVersionMismatch extends Error {}
