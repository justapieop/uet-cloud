import type { Deployment, DeploymentPortMapping, DeploymentVolume } from "@kumo/domain";

export interface DeploymentConfiguration {
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
  readonly deployment: Deployment;
  readonly configuration: DeploymentConfiguration | null;
}

export class DeploymentConfigurationReadError extends Error {
  public constructor(public readonly reason: "unavailable" | "invalid" | "missing") {
    super("Unable to read the applied deployment configuration from Azure");
  }
}
