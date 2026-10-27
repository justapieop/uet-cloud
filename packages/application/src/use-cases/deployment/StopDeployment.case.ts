import { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentRepository } from "../../ports/deployment.js";
import type { ContainerLifecycleManager } from "../../ports/container-lifecycle.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface StopDeploymentInput {
  readonly id: string;
  readonly userId: string;
}

export class StopDeploymentCase {
  private readonly activeOperations: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly lifecycleManager: ContainerLifecycleManager,
    private readonly onStateChanged?: (userId: string) => Promise<void>,
  ) {}

  public async exec(input: StopDeploymentInput): Promise<Deployment> {
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(input.id, input.userId);
    if (!deployment) {
      throw new DeploymentNotFoundError(`Deployment with id ${input.id} was not found`);
    }

    if (deployment.status !== "RUNNING") {
      throw new InvalidDeploymentStatusError(`Cannot stop deployment in status ${deployment.status}; must be RUNNING`);
    }

    if (!await this.repository.transitionStatus(deployment.id, deployment.userId, "RUNNING", "STOPPING")) {
      throw new InvalidDeploymentStatusError("Deployment changed before stop");
    }

    const stopping: Deployment = new Deployment({
      ...deployment.getDetails(),
      status: "STOPPING",
      updatedAt: new Date(),
    });

    const operation: Promise<void> = this.runLifecycle(deployment);
    this.activeOperations.set(deployment.id, operation);
    void operation.finally((): void => {
      this.activeOperations.delete(deployment.id);
    });

    return stopping;
  }

  private async runLifecycle(deployment: Deployment): Promise<void> {
    try {
      await this.lifecycleManager.stopApp(deployment.userId, deployment.name);
      await this.repository.transitionStatus(deployment.id, deployment.userId, "STOPPING", "STOPPED");
    } catch {
      await this.repository.transitionStatus(deployment.id, deployment.userId, "STOPPING", "RUNNING");
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
