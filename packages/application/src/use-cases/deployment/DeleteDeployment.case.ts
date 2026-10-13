import type { Deployment } from "@kumo/domain";
import type {
  DeleteAppParams,
} from "../../ports/azure-deploy.js";
import {
  DeploymentNotFoundError,
  isAzureNotFound,
  sanitizeDeploymentError,
  withDeploymentStatus,
} from "./delete-helpers.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface DeleteDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class DeleteDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: DeleteDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.deleteDeployment(repo, input));
  }

  private async deleteDeployment(repo: UnitOfWorkRepositories, input: DeleteDeploymentInput): Promise<Deployment> {
    const deployment: Deployment | null =
      await repo.deployment.findByIdAndUserId(input.id, input.userId);

    if (!deployment) {
      throw new DeploymentNotFoundError(input.id);
    }

    if (deployment.status === "DELETED") {
      return deployment;
    }

    const resourceGroupName: string =
      repo.azure.getUserResourceGroupName(input.userId);
    const deletingDeployment: Deployment = withDeploymentStatus(
      deployment,
      "DELETING",
    );
    await repo.deployment.update(deletingDeployment);

    const deleteParams: DeleteAppParams = {
      userId: input.userId,
      resourceGroupName,
      appName: deployment.name,
    };

    try {
      await repo.azure.deleteContainerApp(deleteParams);
    } catch (error: unknown) {
      if (!isAzureNotFound(error)) {
        const failedDeployment: Deployment = withDeploymentStatus(
          deployment,
          "FAILED",
          sanitizeDeploymentError(error),
        );
        await repo.deployment.update(failedDeployment);
        throw error;
      }
    }

    const deletedDeployment: Deployment = withDeploymentStatus(
      deployment,
      "DELETED",
    );
    await repo.deployment.update(deletedDeployment);
    return deletedDeployment;
  }
}
