import type { Deployment } from "@kumo/domain";
import type {
  DeleteResourceGroupParams,
} from "../../ports/azure-deploy.js";
import {
  isAzureNotFound,
  sanitizeDeploymentError,
  withDeploymentStatus,
} from "./delete-helpers.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

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
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: DeleteUserResourceGroupInput): Promise<DeleteUserResourceGroupResult> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.deleteRg(repo, input));
  }

  private async deleteRg(
    repo: UnitOfWorkRepositories,
    input: DeleteUserResourceGroupInput,
  ): Promise<DeleteUserResourceGroupResult> {
    const resourceGroupName: string =
      repo.azure.getUserResourceGroupName(input.userId);
    const deployments: Deployment[] =
      await repo.deployment.findByUserId(input.userId);
    const activeDeployments: Deployment[] = deployments.filter(
      (deployment: Deployment): boolean => deployment.status !== "DELETED",
    );
    const deletingDeployments: Deployment[] = activeDeployments.map(
      (deployment: Deployment): Deployment =>
        withDeploymentStatus(deployment, "DELETING"),
    );

    await repo.deployment.updateMany(deletingDeployments);

    const deleteParams: DeleteResourceGroupParams = {
      userId: input.userId,
      resourceGroupName,
    };

    try {
      await repo.azure.deleteResourceGroup(deleteParams);
    } catch (error: unknown) {
      if (!isAzureNotFound(error)) {
        const errorMessage: string = sanitizeDeploymentError(error);
        const failedDeployments: Deployment[] = activeDeployments.map(
          (deployment: Deployment): Deployment =>
            withDeploymentStatus(deployment, "FAILED", errorMessage),
        );
        await repo.deployment.updateMany(failedDeployments);
        throw error;
      }
    }

    const deletedDeployments: Deployment[] = activeDeployments.map(
      (deployment: Deployment): Deployment =>
        withDeploymentStatus(deployment, "DELETED"),
    );
    await repo.deployment.updateMany(deletedDeployments);

    return {
      resourceGroupName,
      status: "DELETED",
      deploymentsSynchronized: activeDeployments.length,
    };
  }
}
