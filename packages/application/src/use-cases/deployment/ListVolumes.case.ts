import type { Deployment, DeploymentVolume, User } from "@kumo/domain";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface ListVolumesInput {
  readonly userId: string;
  readonly deploymentId: string;
}

export class ListVolumesCase {
  public constructor(private readonly uow: UnitOfWork) {}

  public async exec(input: ListVolumesInput): Promise<readonly DeploymentVolume[]> {
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<readonly DeploymentVolume[]> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      return deployment.spec?.volumes ?? [];
    });
  }
}
