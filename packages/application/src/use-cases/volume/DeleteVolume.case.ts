import type { Deployment, DeploymentVolume, User, Volume } from "@kumo/domain";
import type { VolumeManager } from "../../ports/deployment.js";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { VolumeInUseError, VolumeNotFoundError } from "../../ports/volume.js";

export interface DeleteVolumeInput {
  readonly userId: string;
  readonly volumeName: string;
}

export class DeleteVolumeCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly volumeManager: VolumeManager,
  ) {}

  public async exec(input: DeleteVolumeInput): Promise<void> {
    const volume: Volume = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Volume> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");

      const existingVolume: Volume | null = await repo.volumes.findByNameAndUserId(input.volumeName, input.userId);
      if (!existingVolume) {
        throw new VolumeNotFoundError(`Volume '${input.volumeName}' not found`);
      }

      const deployments: Deployment[] = await repo.deployment.findByUserId(input.userId);
      const attachedDeployments: { id: string; name: string }[] = deployments
        .filter((d: Deployment): boolean =>
          d.status !== "DELETED" &&
          d.status !== "FAILED" &&
          Boolean(d.spec?.volumes?.some((v: DeploymentVolume): boolean => v.name === input.volumeName)),
        )
        .map((d: Deployment): { id: string; name: string } => ({ id: d.id, name: d.name }));

      if (attachedDeployments.length > 0) {
        const names: string = attachedDeployments.map((d: { id: string; name: string }): string => d.name).join(", ");
        throw new VolumeInUseError(`Cannot delete volume '${input.volumeName}' while attached to deployments: ${names}`, attachedDeployments);
      }

      return existingVolume;
    });

    if (this.volumeManager.deleteStorageVolume) {
      await this.volumeManager.deleteStorageVolume({
        userId: input.userId,
        volumeName: input.volumeName,
      });
    }

    await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
      await repo.volumes.delete(volume.id);
    });
  }
}
