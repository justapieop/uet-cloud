import type { Deployment, DeploymentVolume, User, Volume } from "@kumo/domain";
import { DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface UserVolumeItem {
  readonly volume: Volume;
  readonly attachedDeployments: readonly { readonly id: string; readonly name: string }[];
}

export interface ListUserVolumesInput {
  readonly userId: string;
}

export class ListUserVolumesCase {
  public constructor(private readonly uow: UnitOfWork) {}

  public async exec(input: ListUserVolumesInput): Promise<readonly UserVolumeItem[]> {
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<readonly UserVolumeItem[]> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");

      const volumes: Volume[] = await repo.volumes.findByUserId(input.userId);
      const deployments: Deployment[] = await repo.deployment.findByUserId(input.userId);

      return volumes.map((volume: Volume): UserVolumeItem => {
        const attachedDeployments: { id: string; name: string }[] = deployments
          .filter((d: Deployment): boolean =>
            Boolean(d.spec?.volumes?.some((v: DeploymentVolume): boolean => v.name === volume.name)),
          )
          .map((d: Deployment): { id: string; name: string } => ({ id: d.id, name: d.name }));

        return { volume, attachedDeployments };
      });
    });
  }
}
