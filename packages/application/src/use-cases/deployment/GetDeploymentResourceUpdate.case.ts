import type { Deployment, DeploymentResourceUpdate, User } from "@kumo/domain";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentResourceUpdateNotFound } from "../../ports/deployment-resource-update.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { resourceUpdateRepository } from "./UpdateDeploymentResources.case.js";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";

export class GetDeploymentResourceUpdateCase {
  public constructor(private readonly uow: UnitOfWork) {}
  public async assertOwner(deploymentId: string, userId: string): Promise<void> {
    await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
      const user: User | null = await repo.users.findById(userId);
      if (!user?.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      if (!await repo.deployment.findByIdAndUserId(deploymentId, userId)) throw new DeploymentNotFoundError("Deployment not found");
    });
  }
  public async exec(deploymentId: string, operationId: string, userId: string): Promise<DeploymentResourceUpdate> {
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<DeploymentResourceUpdate> => {
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(deploymentId, userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      const update: DeploymentResourceUpdate | null = await resourceUpdateRepository(repo).findByIdAndUserId(operationId, userId);
      if (!update || update.deploymentId !== deploymentId) throw new DeploymentResourceUpdateNotFound("Resource update not found");
      return update;
    });
  }
}
