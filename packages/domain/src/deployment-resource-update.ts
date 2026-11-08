import { Domain, InvalidDomainParams } from "./domain.js";
import { validateDeploymentResourceConfiguration, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails } from "./deployment-resource-configuration.js";

export type DeploymentResourceUpdateStatus = "PENDING" | "APPLYING" | "RECONCILING" | "SUCCEEDED" | "FAILED";
export type DeploymentResourceUpdateLifecycle = "RUNNING" | "STOPPED";
export interface DeploymentResourceUpdateReceipt {
  readonly operationId: string;
  readonly deploymentId: string;
  readonly status: "PENDING";
  readonly requested: DeploymentResourceConfigurationDetails;
}
export interface DeploymentResourceUpdateDetails {
  readonly id: string;
  readonly deploymentId: string;
  readonly userId: string;
  readonly keyHash: string;
  readonly fingerprint: string;
  readonly requested: DeploymentResourceConfigurationDetails;
  readonly baseline: DeploymentResourceBaseline;
  readonly lifecycle: DeploymentResourceUpdateLifecycle;
  readonly billingCustomerId: string;
  readonly status: DeploymentResourceUpdateStatus;
  readonly claimToken: string | null;
  readonly claimExpiresAt: Date | null;
  readonly heartbeatAt: Date | null;
  readonly targetRevision: string | null;
  readonly observed: DeploymentResourceConfigurationDetails | null;
  readonly noOp: boolean | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly receipt: DeploymentResourceUpdateReceipt;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}
export class DeploymentResourceUpdate extends Domain<DeploymentResourceUpdateDetails> {
  private readonly snapshot: DeploymentResourceUpdateDetails;
  public constructor(details: DeploymentResourceUpdateDetails) {
    super(details);
    this.snapshot = Object.freeze({
      ...details,
      requested: Object.freeze({ ...details.requested }),
      baseline: Object.freeze({ ...details.baseline, configuration: Object.freeze({ ...details.baseline.configuration }) }),
      receipt: Object.freeze({ ...details.receipt, requested: Object.freeze({ ...details.receipt.requested }) }),
      observed: details.observed === null ? null : Object.freeze({ ...details.observed }),
      createdAt: new Date(details.createdAt), startedAt: details.startedAt === null ? null : new Date(details.startedAt),
      completedAt: details.completedAt === null ? null : new Date(details.completedAt),
      claimExpiresAt: details.claimExpiresAt === null ? null : new Date(details.claimExpiresAt),
      heartbeatAt: details.heartbeatAt === null ? null : new Date(details.heartbeatAt),
    });
  }
  public validate(): InvalidDomainParams | null {
    const details: DeploymentResourceUpdateDetails = this.details;
    if (!details || typeof details !== "object") return new InvalidDomainParams("Invalid resource update details");
    const uuid: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(details.id) || !uuid.test(details.deploymentId) || (typeof details.userId !== "string" || details.userId.trim() === "") || (typeof details.billingCustomerId !== "string" || details.billingCustomerId.trim() === "") ||
      !/^[0-9a-f]{64}$/.test(details.keyHash) || !/^[0-9a-f]{64}$/.test(details.fingerprint)) return new InvalidDomainParams("Invalid resource update identity");
    const error: InvalidDomainParams | null = validateDeploymentResourceConfiguration(details.requested);
    if (error) return error;
    if (!details.baseline || !details.baseline.version || !details.baseline.image || !details.baseline.revisionName || !details.baseline.resourceId ||
      !details.baseline.mainContainerName || !details.baseline.environmentId || details.baseline.revisionMode !== "Single" ||
      !["Running", "Stopped"].includes(details.baseline.runningStatus)) return new InvalidDomainParams("Invalid resource update baseline");
    const baselineError: InvalidDomainParams | null = validateDeploymentResourceConfiguration(details.baseline.configuration);
    if (baselineError) return baselineError;
    if (!["RUNNING", "STOPPED"].includes(details.lifecycle) || !["PENDING", "APPLYING", "RECONCILING", "SUCCEEDED", "FAILED"].includes(details.status)) return new InvalidDomainParams("Invalid resource update state");
    if ((details.status === "SUCCEEDED" || details.status === "FAILED") !== (details.completedAt !== null)) return new InvalidDomainParams("Resource update completion must match terminal state");
    const dates: readonly (Date | null)[] = [details.createdAt, details.startedAt, details.completedAt, details.claimExpiresAt, details.heartbeatAt];
    for (let index: number = 0; index < dates.length; index += 1) {
      const date: Date | null = dates[index]!;
      if (date !== null && (!(date instanceof Date) || Number.isNaN(date.getTime()))) return new InvalidDomainParams("Invalid resource update timestamp");
    }
    if (details.claimToken !== null && !uuid.test(details.claimToken)) return new InvalidDomainParams("Invalid resource update claim token");
    if ((details.claimToken === null) !== (details.claimExpiresAt === null)) return new InvalidDomainParams("Resource update claim requires an expiry");
    if (details.observed !== null) {
      const observedError: InvalidDomainParams | null = validateDeploymentResourceConfiguration(details.observed);
      if (observedError) return observedError;
    }
    if (details.noOp !== null && typeof details.noOp !== "boolean") return new InvalidDomainParams("Invalid resource update no-op value");
    if (details.targetRevision !== null && (typeof details.targetRevision !== "string" || !details.targetRevision || details.targetRevision.length > 128)) return new InvalidDomainParams("Invalid resource update target revision");
    if (details.errorCode !== null && (typeof details.errorCode !== "string" || !/^[A-Z0-9_]{1,64}$/.test(details.errorCode))) return new InvalidDomainParams("Invalid resource update error code");
    if (details.errorMessage !== null && (typeof details.errorMessage !== "string" || details.errorMessage.length > 1000)) return new InvalidDomainParams("Invalid resource update error message");
    if (!details.receipt || details.receipt.operationId !== details.id || details.receipt.deploymentId !== details.deploymentId || details.receipt.status !== "PENDING" ||
      (!details.receipt.requested || details.receipt.requested.maxVcpu !== details.requested.maxVcpu || details.receipt.requested.maxMemory !== details.requested.maxMemory || details.receipt.requested.minScaling !== details.requested.minScaling || details.receipt.requested.maxScaling !== details.requested.maxScaling)) return new InvalidDomainParams("Invalid resource update receipt");
    return null;
  }
  public get id(): string { return this.snapshot.id; }
  public get deploymentId(): string { return this.snapshot.deploymentId; }
  public get userId(): string { return this.snapshot.userId; }
  public get keyHash(): string { return this.snapshot.keyHash; }
  public get fingerprint(): string { return this.snapshot.fingerprint; }
  public get requested(): DeploymentResourceConfigurationDetails { return { ...this.snapshot.requested }; }
  public get baseline(): DeploymentResourceBaseline { return { ...this.snapshot.baseline, configuration: { ...this.snapshot.baseline.configuration } }; }
  public get lifecycle(): DeploymentResourceUpdateLifecycle { return this.snapshot.lifecycle; }
  public get billingCustomerId(): string { return this.snapshot.billingCustomerId; }
  public get status(): DeploymentResourceUpdateStatus { return this.snapshot.status; }
  public get claimToken(): string | null { return this.snapshot.claimToken; }
  public get claimExpiresAt(): Date | null { return this.snapshot.claimExpiresAt === null ? null : new Date(this.snapshot.claimExpiresAt); }
  public get heartbeatAt(): Date | null { return this.snapshot.heartbeatAt === null ? null : new Date(this.snapshot.heartbeatAt); }
  public get targetRevision(): string | null { return this.snapshot.targetRevision; }
  public get observed(): DeploymentResourceConfigurationDetails | null { return this.snapshot.observed ? { ...this.snapshot.observed } : null; }
  public get noOp(): boolean | null { return this.snapshot.noOp; }
  public get errorCode(): string | null { return this.snapshot.errorCode; }
  public get errorMessage(): string | null { return this.snapshot.errorMessage; }
  public get receipt(): DeploymentResourceUpdateReceipt { return { ...this.snapshot.receipt, requested: { ...this.snapshot.receipt.requested } }; }
  public get createdAt(): Date { return new Date(this.snapshot.createdAt); }
  public get startedAt(): Date | null { return this.snapshot.startedAt === null ? null : new Date(this.snapshot.startedAt); }
  public get completedAt(): Date | null { return this.snapshot.completedAt === null ? null : new Date(this.snapshot.completedAt); }
  public getDetails(): DeploymentResourceUpdateDetails { return { ...this.snapshot, requested: this.requested, baseline: this.baseline, observed: this.observed, receipt: this.receipt, createdAt: this.createdAt, startedAt: this.startedAt, completedAt: this.completedAt, claimExpiresAt: this.claimExpiresAt, heartbeatAt: this.heartbeatAt }; }
}
