import { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentRepository } from "../../ports/deployment.js";
import type { ContainerLifecycleManager } from "../../ports/container-lifecycle.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface StopDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class StopDeploymentCase {
  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly lifecycleManager: ContainerLifecycleManager,
  ) {}

  public async exec(input: StopDeploymentInput): Promise<Deployment> {
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(input.id, input.userId);
    if (!deployment) {
      throw new DeploymentNotFoundError(`Deployment with id ${input.id} was not found`);
    }

    if (deployment.status !== "RUNNING") {
      throw new InvalidDeploymentStatusError(`Cannot stop deployment in status ${deployment.status}; must be RUNNING`);
    }

    await this.lifecycleManager.stopApp(deployment.userId, deployment.name);

    const updated: Deployment = new Deployment({
      ...deployment.getDetails(),
      status: "STOPPED",
      updatedAt: new Date(),
    });

    await this.repository.updateProgress(updated);
    return updated;
  }
}
