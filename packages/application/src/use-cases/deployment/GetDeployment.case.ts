import type { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentRepository } from "../../ports/deployment.js";

export class GetDeploymentCase {
  public constructor(private readonly repository: DeploymentRepository) {}

  public async exec(id: string, userId: string): Promise<Deployment> {
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(id, userId);
    if (!deployment) throw new DeploymentNotFoundError("Deployment was not found");
    return deployment;
  }

  public list(userId: string): Promise<Deployment[]> {
    return this.repository.findByUserId(userId);
  }
}
