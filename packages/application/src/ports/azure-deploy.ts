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

export interface DeleteAppParams {
  readonly userId: string;
  readonly resourceGroupName: string;
  readonly appName: string;
}

export interface DeleteResourceGroupParams {
  readonly userId: string;
  readonly resourceGroupName: string;
}

export class UnsafeResourceGroupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsafeResourceGroupError";
  }
}

export interface AzureDeployPort {
  getUserResourceGroupName(userId: string): string;
  ensureUserResourceGroup(userId: string): Promise<string>;
  deployContainerApp(params: DeployAppParams): Promise<{ fqdn: string }>;
  updateContainerApp(params: UpdateAppParams): Promise<{ fqdn: string }>;
  deleteContainerApp(params: DeleteAppParams): Promise<void>;
  deleteResourceGroup(params: DeleteResourceGroupParams): Promise<void>;
}

export const AZURE_DEPLOY_SERVICE: symbol = Symbol("AZURE_DEPLOY_SERVICE");
