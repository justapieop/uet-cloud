import type { Volume } from "@kumo/domain";

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

export class VolumeOperationCoordinator {
  private readonly activeOperations: Map<string, string> = new Map<string, string>();

  public tryAcquire(deploymentId: string, operation: "attach" | "detach"): void {
    if (this.activeOperations.has(deploymentId)) {
      throw new VolumeOperationConflictError();
    }
    this.activeOperations.set(deploymentId, operation);
  }

  public release(deploymentId: string): void {
    this.activeOperations.delete(deploymentId);
  }
}
