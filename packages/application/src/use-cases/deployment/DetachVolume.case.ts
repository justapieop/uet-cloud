import {
  Deployment,
  InvalidDomainParams,
  type DeploymentSpec,
  type DeploymentVolume,
  type User,
  type Volume,
} from "@kumo/domain";
import { DeploymentNotFoundError, type VolumeManager } from "../../ports/deployment.js";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { VolumeInUseError, VolumeOperationCoordinator } from "../../ports/volume.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface DetachVolumeInput {
  readonly userId: string;
  readonly deploymentId: string;
  readonly volumeName: string;
  readonly deleteData?: boolean;
}

export class DetachVolumeCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly volumeManager: VolumeManager,
    private readonly coordinator: VolumeOperationCoordinator = new VolumeOperationCoordinator(),
  ) {}

  public async exec(input: DetachVolumeInput): Promise<Deployment> {
    this.coordinator.tryAcquire(input.deploymentId, "detach");
    try {
      const validated: { readonly deployment: Deployment; readonly existingVolumes: readonly DeploymentVolume[] } =
        await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<{ readonly deployment: Deployment; readonly existingVolumes: readonly DeploymentVolume[] }> => {
          const user: User | null = await repo.users.findById(input.userId);
          if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
          const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
          if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
          if (deployment.status !== "RUNNING" && deployment.status !== "STOPPED" && deployment.status !== "FAILED") {
            throw new InvalidDeploymentStatusError("Deployment must be in RUNNING, STOPPED, or FAILED state to detach volume");
          }
          if (!deployment.spec) {
            throw new InvalidDeploymentStatusError("Deployment has no configuration specification");
          }
          if (!deployment.resourceId && deployment.status !== "FAILED") {
            throw new InvalidDeploymentStatusError("Deployment has no provisioned Azure resource");
          }
          const existingVolumes: readonly DeploymentVolume[] = deployment.spec.volumes ?? [];
          const volumeToDetach: DeploymentVolume | undefined = existingVolumes.find((v: DeploymentVolume): boolean => v.name === input.volumeName);
          if (!volumeToDetach) {
            throw new InvalidDomainParams(`Volume '${input.volumeName}' not found on deployment`);
          }

          if (input.deleteData) {
            const userDeployments: Deployment[] = await repo.deployment.findByUserId(input.userId);
            const otherDeployments: { readonly id: string; readonly name: string }[] = userDeployments
              .filter((d: Deployment): boolean =>
                d.id !== input.deploymentId &&
                d.status !== "DELETED" &&
                d.status !== "FAILED" &&
                Boolean(d.spec?.volumes?.some((v: DeploymentVolume): boolean => v.name === input.volumeName)),
              )
              .map((d: Deployment): { readonly id: string; readonly name: string } => ({ id: d.id, name: d.name }));

            if (otherDeployments.length > 0) {
              const names: string = otherDeployments.map((d: { readonly id: string; readonly name: string }): string => d.name).join(", ");
              throw new VolumeInUseError(`Cannot delete volume '${input.volumeName}' because it is still in use by other deployments: ${names}`, otherDeployments);
            }
          }

          return { deployment, existingVolumes };
        });

      if (validated.deployment.resourceId) {
        await this.volumeManager.detachVolume({
          userId: input.userId,
          appName: validated.deployment.name,
          deploymentId: validated.deployment.id,
          resourceId: validated.deployment.resourceId,
          volumeName: input.volumeName,
          existingVolumes: validated.existingVolumes,
          deleteData: input.deleteData,
        });
      } else if (input.deleteData && this.volumeManager.deleteStorageVolume) {
        await this.volumeManager.deleteStorageVolume({
          userId: input.userId,
          volumeName: input.volumeName,
        });
      }

      return await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
        const currentDeployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
        if (!currentDeployment) throw new DeploymentNotFoundError("Deployment not found");
        if (!currentDeployment.spec) throw new InvalidDeploymentStatusError("Deployment has no configuration specification");

        if (input.deleteData) {
          const existingVolRecord: Volume | null = await repo.volumes.findByNameAndUserId(input.volumeName, input.userId);
          if (existingVolRecord) {
            await repo.volumes.delete(existingVolRecord.id);
          }
        }

        const currentVolumes: readonly DeploymentVolume[] = currentDeployment.spec.volumes ?? [];
        const updatedVolumes: readonly DeploymentVolume[] = currentVolumes.filter((v: DeploymentVolume): boolean => v.name !== input.volumeName);
        const updatedSpec: DeploymentSpec = { ...currentDeployment.spec, volumes: updatedVolumes };
        const updated: Deployment = new Deployment({
          ...currentDeployment.getDetails(),
          spec: updatedSpec,
          updatedAt: new Date(),
        });
        await repo.deployment.save(updated);
        return updated;
      });
    } finally {
      this.coordinator.release(input.deploymentId);
    }
  }
}
