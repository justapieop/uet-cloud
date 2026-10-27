import { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentRepository } from "../../ports/deployment.js";
import type { ContainerLifecycleManager } from "../../ports/container-lifecycle.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface StartDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class StartDeploymentCase {
  private readonly activeOperations: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly lifecycleManager: ContainerLifecycleManager,
    private readonly onStateChanged?: (userId: string) => Promise<void>,
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

    const starting: Deployment = new Deployment({
      ...deployment.getDetails(),
      status: "STARTING",
      updatedAt: new Date(),
    });

    const operation: Promise<void> = this.runLifecycle(deployment);
    this.activeOperations.set(deployment.id, operation);
    void operation.finally((): void => {
      this.activeOperations.delete(deployment.id);
    });

    return starting;
  }

  private async runLifecycle(deployment: Deployment): Promise<void> {
    try {
      await this.lifecycleManager.startApp(deployment.userId, deployment.name);
      await this.repository.transitionStatus(deployment.id, deployment.userId, "STARTING", "RUNNING");
    } catch {
      await this.repository.transitionStatus(deployment.id, deployment.userId, "STARTING", "STOPPED");
    } finally {
      if (this.onStateChanged) {
        await this.onStateChanged(deployment.userId).catch((): void => {});
      }
    }
  }

  public async waitForActive(): Promise<void> {
    await Promise.all(Array.from(this.activeOperations.values()));
  }
}
