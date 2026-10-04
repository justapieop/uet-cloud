import type { Deployment } from "@kumo/domain";
import type {
  AzureDeployPort,
  DeleteResourceGroupParams,
} from "../../ports/azure-deploy.js";
import type { DeploymentRepository } from "../../ports/deployment.js";
import {
  isAzureNotFound,
  sanitizeDeploymentError,
  withDeploymentStatus,
} from "./delete-helpers.js";

export interface DeleteUserResourceGroupInput {
  readonly userId: string;
}

export interface DeleteUserResourceGroupResult {
  readonly resourceGroupName: string;
  readonly status: "DELETED";
  readonly deploymentsSynchronized: number;
}

export class DeleteUserResourceGroupCase {
  public constructor(
    private readonly deployService: AzureDeployPort,
    private readonly deploymentRepository: DeploymentRepository,
  ) {}

  public async exec(
    input: DeleteUserResourceGroupInput,
  ): Promise<DeleteUserResourceGroupResult> {
    const resourceGroupName: string =
      this.deployService.getUserResourceGroupName(input.userId);
    const deployments: Deployment[] =
      await this.deploymentRepository.findByUserId(input.userId);
    const activeDeployments: Deployment[] = deployments.filter(
      (deployment: Deployment): boolean => deployment.status !== "DELETED",
    );
    const deletingDeployments: Deployment[] = activeDeployments.map(
      (deployment: Deployment): Deployment =>
        withDeploymentStatus(deployment, "DELETING"),
    );

    await this.deploymentRepository.updateMany(deletingDeployments);

    const deleteParams: DeleteResourceGroupParams = {
      userId: input.userId,
      resourceGroupName,
    };

    try {
      await this.deployService.deleteResourceGroup(deleteParams);
    } catch (error: unknown) {
      if (!isAzureNotFound(error)) {
        const errorMessage: string = sanitizeDeploymentError(error);
        const failedDeployments: Deployment[] = activeDeployments.map(
          (deployment: Deployment): Deployment =>
            withDeploymentStatus(deployment, "FAILED", errorMessage),
        );
        await this.deploymentRepository.updateMany(failedDeployments);
        throw error;
      }
    }

    const deletedDeployments: Deployment[] = activeDeployments.map(
      (deployment: Deployment): Deployment =>
        withDeploymentStatus(deployment, "DELETED"),
    );
    await this.deploymentRepository.updateMany(deletedDeployments);

    return {
      resourceGroupName,
      status: "DELETED",
      deploymentsSynchronized: activeDeployments.length,
    };
  }
}
