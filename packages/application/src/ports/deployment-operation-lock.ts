export type DeploymentOperation = "delete" | "attach" | "detach" | "configure" | "redeploy" | "scale" | "scale-rule";

export interface DeploymentOperationLease {
  readonly deploymentId: string;
  readonly operation: DeploymentOperation;
  readonly token: string;
}

export interface DeploymentOperationLock {
  readonly leaseDurationMs: number;
  acquire(deploymentId: string, operation: DeploymentOperation): Promise<DeploymentOperationLease | null>;
  renew(lease: DeploymentOperationLease): Promise<boolean>;
  release(lease: DeploymentOperationLease): Promise<void>;
}

export const DEPLOYMENT_OPERATION_LOCK: symbol = Symbol("DEPLOYMENT_OPERATION_LOCK");

export class DeploymentOperationConflictError extends Error {
  public constructor(message?: string) {
    super(message ?? "Another operation is already in progress for this deployment. Please wait until it completes.");
    this.name = "DeploymentOperationConflictError";
  }
}

export class DeploymentOperationLeaseLostError extends Error {
  public constructor() {
    super("The deployment operation lock was lost before the operation completed");
    this.name = "DeploymentOperationLeaseLostError";
  }
}
