import { Deployment } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/index.js";
import { DeploymentNotFound } from "../exceptions/DeploymentNotFound.exception.js";

export interface UpdateDeploymentInput {
  id: string;
  userId: string;
  name?: string;
}

export class UpdateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork
  ) { }

  public exec(input: UpdateDeploymentInput): Promise<void> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.updateDeployment(repo, input));
  }

  private async updateDeployment(repo: UnitOfWorkRepositories, input: UpdateDeploymentInput): Promise<void> {
    const currentDeployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.id, input.userId);

    if (!currentDeployment) {
      throw new DeploymentNotFound(`Deployment with id ${input.id} not found`)
    }

    await repo.deployment.update(new Deployment({
      ...currentDeployment.getDetails(),
      id: input.id,
      userId: input.userId,
      name: input.name ?? currentDeployment.name,
      createdAt: currentDeployment.createdAt,
      updatedAt: new Date(),
    }));
  }
}

