import type { Deployment } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import type { DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import { VolumeOperationCoordinator } from "../../ports/volume.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";

export interface DeleteDeploymentInput {
  id: string;
  userId: string;
}

export class DeleteDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly operationLock: DeploymentOperationLock = new VolumeOperationCoordinator(),
  ) { }
  
  public exec(input: DeleteDeploymentInput): Promise<void> {
    return withDeploymentOperationLock(this.operationLock, input.id, "delete", async (signal: AbortSignal): Promise<void> => {
      await this.uow.run((repo: UnitOfWorkRepositories): Promise<void> => this.requestDeletion(repo, input, signal));
    });
  }

  private async requestDeletion(repo: UnitOfWorkRepositories, input: DeleteDeploymentInput, signal: AbortSignal): Promise<void> {
    assertDeploymentOperationLease(signal);
    const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.id, input.userId);
    if (!deployment) throw new DeploymentNotFoundError(`Deployment with id ${input.id} was not found`);
    if (deployment.activeResourceUpdateId) throw new InvalidDeploymentStatusError("A resource update is still in progress");
    if (deployment.status === "DELETE_PENDING" || deployment.status === "DELETING" || deployment.status === "DELETED") return;
    if (deployment.status !== "PENDING" && deployment.status !== "RUNNING" && deployment.status !== "STOPPED" &&
      deployment.status !== "FAILED" && deployment.status !== "DELETE_FAILED") {
      throw new InvalidDeploymentStatusError(`Cannot delete deployment in status ${deployment.status}`);
    }
    const transitioned: boolean = await repo.deployment.transitionStatus(
      deployment.id,
      deployment.userId,
      deployment.status,
      "DELETE_PENDING",
      { clearError: true },
    );
    if (!transitioned) throw new InvalidDeploymentStatusError("Deployment changed before the deletion request was accepted");
    await repo.scaleRules.delete(deployment.id);
  }
}
