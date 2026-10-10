import type { Deployment } from "@kumo/domain";
import type {
  AzureDeployPort,
  DeleteAppParams,
} from "../../ports/azure-deploy.js";
import type { DeploymentRepository } from "../../ports/deployment.js";
import {
  DeploymentNotFoundError,
  isAzureNotFound,
  sanitizeDeploymentError,
  withDeploymentStatus,
} from "./delete-helpers.js";

export interface DeleteDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class DeleteDeploymentCase {
  public constructor(
    private readonly deployService: AzureDeployPort,
    private readonly deploymentRepository: DeploymentRepository,
  ) {}

  public async exec(input: DeleteDeploymentInput): Promise<Deployment> {
    const deployment: Deployment | null =
      await this.deploymentRepository.findByIdAndUserId(input.id, input.userId);

    if (!deployment) {
      throw new DeploymentNotFoundError(input.id);
    }

    if (deployment.status === "DELETED") {
      return deployment;
    }

    const resourceGroupName: string =
      this.deployService.getUserResourceGroupName(input.userId);
    const deletingDeployment: Deployment = withDeploymentStatus(
      deployment,
      "DELETING",
    );
    await this.deploymentRepository.update(deletingDeployment);

    const deleteParams: DeleteAppParams = {
      userId: input.userId,
      resourceGroupName,
      appName: deployment.name,
    };

    try {
      await this.deployService.deleteContainerApp(deleteParams);
    } catch (error: unknown) {
      if (!isAzureNotFound(error)) {
        const failedDeployment: Deployment = withDeploymentStatus(
          deployment,
          "FAILED",
          sanitizeDeploymentError(error),
        );
        await this.deploymentRepository.update(failedDeployment);
        throw error;
      }
    }

    const deletedDeployment: Deployment = withDeploymentStatus(
      deployment,
      "DELETED",
    );
    await this.deploymentRepository.update(deletedDeployment);
    return deletedDeployment;
  }
}
