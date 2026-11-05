import { Deployment, type DeploymentVolume } from "@kumo/domain";
import type { DeploymentResourceDeleter } from "../../ports/deployment-deletion.js";
import type { DeploymentRepository } from "../../ports/deployment.js";

export class ProcessDeploymentDeletionCase {
  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly deleter: DeploymentResourceDeleter,
  ) {}

  public async exec(claimed: Deployment): Promise<void> {
    if (claimed.status !== "DELETING") throw new Error("Deployment must be claimed before deletion processing");

    let current: Deployment = claimed;
    try {
      if (!current.containerAppDeletedAt) {
        if (!current.containerAppEnvironmentId) {
          const environmentId: string | null = await this.deleter.resolveContainerAppEnvironmentId({
            deploymentId: current.id,
            userId: current.userId,
            appName: current.name,
            resourceId: current.resourceId,
          });
          if (environmentId) {
            current = new Deployment({
              ...current.getDetails(),
              containerAppEnvironmentId: environmentId,
              updatedAt: new Date(),
            });
            await this.repository.updateProgress(current);
          }
        }

        await this.deleter.deleteContainerApp({
          deploymentId: current.id,
          userId: current.userId,
          appName: current.name,
          resourceId: current.resourceId,
          environmentId: current.containerAppEnvironmentId,
        });
        current = new Deployment({
          ...current.getDetails(),
          containerAppDeletedAt: new Date(),
          updatedAt: new Date(),
        });
        await this.repository.updateProgress(current);
      }

      const volumes: readonly DeploymentVolume[] = current.spec?.volumes ?? [];
      if (volumes.length > 0) {
        await this.deleter.deleteDeploymentStorageLinks({
          deploymentId: current.id,
          userId: current.userId,
          appName: current.name,
          environmentId: current.containerAppEnvironmentId,
          volumes,
        });
      }

      await this.repository.updateProgress(new Deployment({
        ...current.getDetails(),
        status: "DELETED",
        error: null,
        updatedAt: new Date(),
      }));
    } catch {
      const error: string = current.containerAppDeletedAt
        ? "Deployment storage-link cleanup failed"
        : "Deployment deletion failed";
      await this.repository.updateProgress(new Deployment({
        ...current.getDetails(),
        status: "DELETE_FAILED",
        error,
        updatedAt: new Date(),
      }));
    }
  }
}
