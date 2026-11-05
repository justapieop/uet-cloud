import type { DeploymentVolume } from "@kumo/domain";

export interface ResolveContainerAppEnvironmentInput {
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
  readonly resourceId: string | null;
}

export interface DeleteContainerAppInput extends ResolveContainerAppEnvironmentInput {
  readonly environmentId: string | null;
}

export interface DeleteDeploymentStorageLinksInput {
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
  readonly environmentId: string | null;
  readonly volumes: readonly DeploymentVolume[];
}

export interface DeploymentResourceDeleter {
  resolveContainerAppEnvironmentId(input: ResolveContainerAppEnvironmentInput): Promise<string | null>;
  deleteContainerApp(input: DeleteContainerAppInput): Promise<void>;
  deleteDeploymentStorageLinks(input: DeleteDeploymentStorageLinksInput): Promise<void>;
}

export const DEPLOYMENT_RESOURCE_DELETER: symbol = Symbol("DEPLOYMENT_RESOURCE_DELETER");
