import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export const VOLUME_NAME_PATTERN: RegExp = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

export interface VolumeDetails {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly sizeGb: number;
  readonly region: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export class Volume extends Domain<VolumeDetails> {
  public readonly id!: string;
  public readonly userId!: string;
  public readonly name!: string;
  public readonly sizeGb!: number;
  public readonly region!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public constructor(details: VolumeDetails) {
    super(details);

    this.id = details.id;
    this.userId = details.userId;
    this.name = details.name;
    this.sizeGb = details.sizeGb;
    this.region = details.region;
    this.createdAt = details.createdAt ?? new Date();
    this.updatedAt = details.updatedAt ?? new Date();
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) {
      return new InvalidDomainParams("Volume.id must not be blank");
    }

    if (isBlankStr(this.details.userId)) {
      return new InvalidDomainParams("Volume.userId must not be blank");
    }

    if (isBlankStr(this.details.name) || !VOLUME_NAME_PATTERN.test(this.details.name)) {
      return new InvalidDomainParams(
        "Volume.name must be 2-32 lowercase letters, numbers, or hyphens, starting with a letter and ending with an alphanumeric character",
      );
    }

    if (!Number.isSafeInteger(this.details.sizeGb) || this.details.sizeGb < 1) {
      return new InvalidDomainParams("Volume.sizeGb must be a positive integer in GiB");
    }

    if (isBlankStr(this.details.region)) {
      return new InvalidDomainParams("Volume.region must not be blank");
    }

    return null;
  }
}
