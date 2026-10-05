import type { DeploymentSpec } from "@kumo/domain";

export interface DeployAppParams {
  readonly resourceGroupName: string;
  readonly appName: string;
  readonly spec: DeploymentSpec;
}

export interface UpdateAppParams {
  readonly resourceGroupName: string;
  readonly appName: string;
  readonly spec: Partial<DeploymentSpec>;
}

export interface AzureDeployPort {
  ensureUserResourceGroup(userId: string): Promise<string>;
  deployContainerApp(params: DeployAppParams): Promise<{ fqdn: string }>;
  updateContainerApp(params: UpdateAppParams): Promise<{ fqdn: string }>;
}

export const AZURE_DEPLOY_SERVICE: symbol = Symbol("AZURE_DEPLOY_SERVICE");
