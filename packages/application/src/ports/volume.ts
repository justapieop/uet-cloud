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
