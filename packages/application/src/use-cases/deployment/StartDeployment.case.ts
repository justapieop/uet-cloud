import { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentRepository } from "../../ports/deployment.js";
import type { ContainerLifecycleManager } from "../../ports/container-lifecycle.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface StartDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class StartDeploymentCase {
  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly lifecycleManager: ContainerLifecycleManager,
  ) {}

  public async exec(input: StartDeploymentInput): Promise<Deployment> {
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(input.id, input.userId);
    if (!deployment) {
      throw new DeploymentNotFoundError(`Deployment with id ${input.id} was not found`);
    }

    if (deployment.status !== "STOPPED") {
      throw new InvalidDeploymentStatusError(`Cannot start deployment in status ${deployment.status}; must be STOPPED`);
    }

    if (!await this.repository.transitionStatus(deployment.id, deployment.userId, "STOPPED", "STARTING")) {
      throw new InvalidDeploymentStatusError("Deployment changed before start");
    }
    try {
      await this.lifecycleManager.startApp(deployment.userId, deployment.name);
    } catch (error: unknown) {
      await this.repository.transitionStatus(deployment.id, deployment.userId, "STARTING", "STOPPED");
      throw error;
    }

    const updated: Deployment = new Deployment({
      ...deployment.getDetails(),
      status: "RUNNING",
      updatedAt: new Date(),
    });

    if (!await this.repository.transitionStatus(deployment.id, deployment.userId, "STARTING", "RUNNING")) throw new InvalidDeploymentStatusError("Deployment changed during start");
    return updated;
  }
}
