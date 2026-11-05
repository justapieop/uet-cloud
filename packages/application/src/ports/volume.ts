import type { Volume } from "@kumo/domain";
import { randomUUID } from "node:crypto";
import type { DeploymentOperation, DeploymentOperationLease, DeploymentOperationLock } from "./deployment-operation-lock.js";

export interface VolumeRepository {
  findById(id: string): Promise<Volume | null>;
  findByIdAndUserId(id: string, userId: string): Promise<Volume | null>;
  findByNameAndUserId(name: string, userId: string): Promise<Volume | null>;
  findByUserId(userId: string): Promise<Volume[]>;
  save(volume: Volume): Promise<void>;
  delete(id: string): Promise<void>;
}

export const VOLUME_REPOSITORY: symbol = Symbol("VOLUME_REPOSITORY");

export class VolumeAlreadyExists extends Error {}
export class VolumeNotFoundError extends Error {}
export class VolumeInUseError extends Error {
  public constructor(
    message: string,
    public readonly attachedDeployments: readonly { readonly id: string; readonly name: string }[] = [],
  ) {
    super(message);
  }
}

export class VolumeOperationConflictError extends Error {
  public constructor(message?: string) {
    super(message ?? "Another volume operation is already in progress for this deployment. Please wait until it completes.");
    this.name = "VolumeOperationConflictError";
  }
}

export class VolumeOperationCoordinator implements DeploymentOperationLock {
  public readonly leaseDurationMs: number = 120_000;
  private readonly activeOperations: Map<string, DeploymentOperationLease> = new Map<string, DeploymentOperationLease>();

  public tryAcquire(deploymentId: string, operation: "attach" | "detach"): void {
    if (this.activeOperations.has(deploymentId)) {
      throw new VolumeOperationConflictError();
    }
    this.activeOperations.set(deploymentId, { deploymentId, operation, token: randomUUID() });
  }

  public async acquire(deploymentId: string, operation: DeploymentOperation): Promise<DeploymentOperationLease | null> {
    if (this.activeOperations.has(deploymentId)) return null;
    const lease: DeploymentOperationLease = { deploymentId, operation, token: randomUUID() };
    this.activeOperations.set(deploymentId, lease);
    return lease;
  }

  public async renew(lease: DeploymentOperationLease): Promise<boolean> {
    const current: DeploymentOperationLease | undefined = this.activeOperations.get(lease.deploymentId);
    return current?.token === lease.token;
  }

  public async release(leaseOrDeploymentId: DeploymentOperationLease | string): Promise<void> {
    const deploymentId: string = typeof leaseOrDeploymentId === "string" ? leaseOrDeploymentId : leaseOrDeploymentId.deploymentId;
    const current: DeploymentOperationLease | undefined = this.activeOperations.get(deploymentId);
    if (typeof leaseOrDeploymentId === "string" || current?.token === leaseOrDeploymentId.token) {
      this.activeOperations.delete(deploymentId);
    }
  }
}
