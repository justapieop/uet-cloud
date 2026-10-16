import { randomUUID } from "node:crypto";
import { Deployment, InvalidDomainParams, type DeploymentSpec } from "@kumo/domain";
import { DeploymentAlreadyExists } from "../../ports/deployment.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface CreateDeploymentInput {
  userId: string;
  name: string;
  spec: DeploymentSpec;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: CreateDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.createDeployment(repo, input));
  }

  public async createDeployment(repo: UnitOfWorkRepositories, input: CreateDeploymentInput): Promise<Deployment> {
    if (!input.spec) throw new InvalidDomainParams("A deployment creation specification is required");
    const deployment: Deployment = new Deployment({
      id: randomUUID(),
      name: input.name,
      userId: input.userId,
      spec: input.spec,
      status: "PENDING",
    });

    const existing: Deployment[] = await repo.deployment.findByUserId(input.userId);
    if (existing.some((item: Deployment): boolean => item.name === input.name)) {
      throw new DeploymentAlreadyExists("A deployment with this name already exists for the user");
    }

    await repo.deployment.save(deployment);

    return deployment;
  }
}
