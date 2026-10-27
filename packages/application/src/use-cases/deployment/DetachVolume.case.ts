import {
  Deployment,
  InvalidDomainParams,
  type DeploymentSpec,
  type DeploymentVolume,
  type User,
} from "@kumo/domain";
import { DeploymentNotFoundError, type VolumeManager } from "../../ports/deployment.js";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
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
  ) {}

  public async exec(input: DetachVolumeInput): Promise<Deployment> {
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
      const user: User | null = await repo.users.findByIdForUpdate(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      if (deployment.status !== "RUNNING" && deployment.status !== "STOPPED") {
        throw new InvalidDeploymentStatusError("Deployment must be in RUNNING or STOPPED state to detach volume");
      }
      if (!deployment.resourceId || !deployment.spec) {
        throw new InvalidDeploymentStatusError("Deployment has no provisioned Azure resource");
      }
      const existingVolumes: readonly DeploymentVolume[] = deployment.spec.volumes ?? [];
      const volumeToDetach: DeploymentVolume | undefined = existingVolumes.find((v: DeploymentVolume): boolean => v.name === input.volumeName);
      if (!volumeToDetach) {
        throw new InvalidDomainParams(`Volume '${input.volumeName}' not found on deployment`);
      }

      await this.volumeManager.detachVolume({
        userId: input.userId,
        appName: deployment.name,
        deploymentId: deployment.id,
        resourceId: deployment.resourceId,
        volumeName: input.volumeName,
        existingVolumes,
        deleteData: input.deleteData,
      });

      const updatedVolumes: readonly DeploymentVolume[] = existingVolumes.filter((v: DeploymentVolume): boolean => v.name !== input.volumeName);
      const updatedSpec: DeploymentSpec = { ...deployment.spec, volumes: updatedVolumes };
      const updated: Deployment = new Deployment({
        ...deployment.getDetails(),
        spec: updatedSpec,
        updatedAt: new Date(),
      });
      await repo.deployment.save(updated);
      return updated;
    });
  }
}
