import type { DeploymentDetails } from "@kumo/domain";

export interface DeploymentRequestReceipt {
  readonly fingerprint: string;
  readonly deployment: DeploymentDetails;
}

export interface DeploymentRequestRepository {
  findForUpdate(keyHash: string): Promise<DeploymentRequestReceipt | null>;
  save(keyHash: string, receipt: DeploymentRequestReceipt): Promise<void>;
}

export class DeploymentRequestKeyReused extends Error {}
export class DeploymentRequestInProgress extends Error {}
