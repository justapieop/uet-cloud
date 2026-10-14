import { Domain, InvalidDomainParams } from "./domain.js";

export type BuildStatus = "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface BuildDetails {
  readonly id: string;
  readonly userId: string;
  readonly repo: string;
  readonly commitSha: string;
  readonly dockerFilePath: string;
  readonly image: string;
  readonly status: BuildStatus;
  readonly sourceTokenHash: string;
  readonly sourceExpiresAt: Date;
  readonly runId: string | null;
  readonly runUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Build extends Domain<BuildDetails> {
  public constructor(details: BuildDetails) { super(details); }
  public getDetails(): BuildDetails { return { ...this.details }; }
  public validate(): InvalidDomainParams | null {
    if (
      !this.details.id || !this.details.userId || !this.details.repo ||
      !/^[a-f0-9]{40}$/i.test(this.details.commitSha) ||
      !this.details.dockerFilePath || !this.details.image ||
      !/^[a-f0-9]{64}$/.test(this.details.sourceTokenHash) ||
      !["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].includes(this.details.status) ||
      !Number.isFinite(this.details.sourceExpiresAt.getTime())
    ) return new InvalidDomainParams("Invalid build details");
    return null;
  }
}
