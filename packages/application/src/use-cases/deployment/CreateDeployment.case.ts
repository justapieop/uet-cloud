import { Deployment } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface CreateDeploymentInput {
  id: string;
  userId: string;
  name: string;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: CreateDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.createDeployment(repo, input));
  }

  public async createDeployment(repo: UnitOfWorkRepositories, input: CreateDeploymentInput): Promise<Deployment> {
    const deployment: Deployment = new Deployment({
      id: input.id,
      name: input.name,
      userId: input.userId,
    });

    await repo.deployment.save(deployment);

    return deployment;
  }
}
