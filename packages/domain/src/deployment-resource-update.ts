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
  public constructor(details: DeploymentResourceUpdateDetails) { super(details); }
  public validate(): InvalidDomainParams | null {
    const details: DeploymentResourceUpdateDetails = this.details;
    const uuid: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(details.id) || !uuid.test(details.deploymentId) || !details.userId || !details.billingCustomerId ||
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
    if (details.receipt.operationId !== details.id || details.receipt.deploymentId !== details.deploymentId || details.receipt.status !== "PENDING" ||
      JSON.stringify(details.receipt.requested) !== JSON.stringify(details.requested)) return new InvalidDomainParams("Invalid resource update receipt");
    return null;
  }
  public get id(): string { return this.details.id; }
  public get deploymentId(): string { return this.details.deploymentId; }
  public get userId(): string { return this.details.userId; }
  public get keyHash(): string { return this.details.keyHash; }
  public get fingerprint(): string { return this.details.fingerprint; }
  public get requested(): DeploymentResourceConfigurationDetails { return { ...this.details.requested }; }
  public get baseline(): DeploymentResourceBaseline { return { ...this.details.baseline, configuration: { ...this.details.baseline.configuration } }; }
  public get lifecycle(): DeploymentResourceUpdateLifecycle { return this.details.lifecycle; }
  public get billingCustomerId(): string { return this.details.billingCustomerId; }
  public get status(): DeploymentResourceUpdateStatus { return this.details.status; }
  public get claimToken(): string | null { return this.details.claimToken; }
  public get claimExpiresAt(): Date | null { return this.details.claimExpiresAt; }
  public get heartbeatAt(): Date | null { return this.details.heartbeatAt; }
  public get targetRevision(): string | null { return this.details.targetRevision; }
  public get observed(): DeploymentResourceConfigurationDetails | null { return this.details.observed ? { ...this.details.observed } : null; }
  public get noOp(): boolean | null { return this.details.noOp; }
  public get errorCode(): string | null { return this.details.errorCode; }
  public get errorMessage(): string | null { return this.details.errorMessage; }
  public get receipt(): DeploymentResourceUpdateReceipt { return { ...this.details.receipt, requested: { ...this.details.receipt.requested } }; }
  public get createdAt(): Date { return this.details.createdAt; }
  public get startedAt(): Date | null { return this.details.startedAt; }
  public get completedAt(): Date | null { return this.details.completedAt; }
  public getDetails(): DeploymentResourceUpdateDetails { return { ...this.details, requested: this.requested, baseline: this.baseline, observed: this.observed, receipt: this.receipt }; }
}
