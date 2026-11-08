import type { Deployment, DeploymentPortMapping, DeploymentVolume, DeploymentResourceBaseline, DeploymentResourceConfigurationDetails, DeploymentResourceUpdateLifecycle, DeploymentResourceUpdate } from "@kumo/domain";

export interface DeploymentConfiguration {
  readonly configurationVersion?: string | null;
  readonly resourceBaseline?: DeploymentResourceBaseline | null;
  readonly region: string;
  readonly maxVcpu: number | null;
  readonly maxMemory: number | null;
  readonly minScaling: number | null;
  readonly maxScaling: number | null;
  readonly targetPort: number | null;
  readonly external: boolean | null;
  readonly additionalPorts: readonly DeploymentPortMapping[];
  readonly volumes?: readonly DeploymentVolume[];
  readonly image: string | null;
  readonly fqdn: string | null;
}

export interface DeploymentConfigurationReader {
  read(input: { readonly resourceId: string; readonly deploymentId: string; readonly userId: string; readonly appName: string }): Promise<DeploymentConfiguration>;
}

export interface DeploymentReadResult {
  readonly resourceUpdate?: DeploymentResourceUpdate | null;
  readonly deployment: Deployment;
  readonly configuration: DeploymentConfiguration | null;
}

export class DeploymentConfigurationReadError extends Error {
  public constructor(public readonly reason: "unavailable" | "invalid" | "missing") {
    super("Unable to read the applied deployment configuration from Azure");
  }
}

export interface DeploymentConfigurationIdentity {
  readonly resourceId: string;
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
}
export interface DeploymentResourceApplyInput extends DeploymentConfigurationIdentity {
  readonly operationId: string;
  readonly baseline: DeploymentResourceBaseline;
  readonly requested: DeploymentResourceConfigurationDetails;
  readonly lifecycle: DeploymentResourceUpdateLifecycle;
  readonly abortSignal: AbortSignal;
  /** Must complete successfully before any ARM mutation, including a retry; its durable marker fences submission. */
  readonly onTargetRevision: (targetRevision: string) => Promise<void>;
}
export interface DeploymentResourceApplyResult {
  readonly observed: DeploymentResourceConfigurationDetails;
  readonly targetRevision: string;
  readonly noOp: boolean;
}
export interface DeploymentResourceReconcileInput extends DeploymentConfigurationIdentity {
  readonly operationId: string;
  readonly baseline: DeploymentResourceBaseline;
  readonly requested: DeploymentResourceConfigurationDetails;
  readonly lifecycle: DeploymentResourceUpdateLifecycle;
  readonly targetRevision: string | null;
  readonly abortSignal: AbortSignal;
}
export type DeploymentResourceReconcileResult =
  | { readonly outcome: "succeeded"; readonly observed: DeploymentResourceConfigurationDetails; readonly targetRevision: string; readonly noOp: boolean }
  | { readonly outcome: "failed"; readonly observed?: DeploymentResourceConfigurationDetails | null; readonly targetRevision?: string | null; readonly errorCode: string; readonly errorMessage: string }
  | { readonly outcome: "unknown"; readonly observed?: DeploymentResourceConfigurationDetails | null; readonly targetRevision?: string | null };
export interface DeploymentConfigurationUpdater {
  readonly supportsStopped: boolean;
  readBaseline(input: DeploymentConfigurationIdentity): Promise<DeploymentResourceBaseline>;
  update(input: DeploymentResourceApplyInput): Promise<DeploymentResourceApplyResult>;
  reconcile(input: DeploymentResourceReconcileInput): Promise<DeploymentResourceReconcileResult>;
}
export const DEPLOYMENT_CONFIGURATION_UPDATER: symbol = Symbol("DEPLOYMENT_CONFIGURATION_UPDATER");
