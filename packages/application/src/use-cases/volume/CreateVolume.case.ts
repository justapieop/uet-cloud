import { Volume, type Plan, type User } from "@kumo/domain";
import { randomUUID } from "node:crypto";
import type { VolumeManager } from "../../ports/deployment.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { VolumeAlreadyExists } from "../../ports/volume.js";

export interface CreateVolumeInput {
  readonly userId: string;
  readonly name: string;
  readonly sizeGb: number;
  readonly region: string;
}

export class CreateVolumeCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
    private readonly volumeManager: VolumeManager,
  ) {}

  public async exec(input: CreateVolumeInput): Promise<Volume> {
    const volumeId: string = randomUUID();
    const volume: Volume = new Volume({
      id: volumeId,
      userId: input.userId,
      name: input.name,
      sizeGb: input.sizeGb,
      region: input.region,
    });

    const initialUser: User = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<User> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const existingVolume: Volume | null = await repo.volumes.findByNameAndUserId(input.name, input.userId);
      if (existingVolume) {
        throw new VolumeAlreadyExists(`Volume '${input.name}' already exists`);
      }
      return user;
    });

    if (!initialUser.stripeCustomerId) {
      throw new DeploymentSubscriptionRequired("An active subscription linked to a Kumo plan is required");
    }
    const productIds: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initialUser.stripeCustomerId);

    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Volume> => {
      const user: User | null = await repo.users.findByIdForUpdate(input.userId);
      if (!user || user.suspended || user.stripeCustomerId !== initialUser.stripeCustomerId) {
        throw new DeploymentSubscriptionRequired("The user or billing association changed; retry the request");
      }
      const existingVolume: Volume | null = await repo.volumes.findByNameAndUserId(input.name, input.userId);
      if (existingVolume) {
        throw new VolumeAlreadyExists(`Volume '${input.name}' already exists`);
      }
      const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(productIds);
      if (plans.length === 0) {
        throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
      }
      const userVolumes: Volume[] = await repo.volumes.findByUserId(input.userId);
      const totalDisk: number = userVolumes.reduce((sum: number, v: Volume): number => sum + v.sizeGb, 0) + input.sizeGb;
      const eligible: boolean = plans.some((p: Plan): boolean => totalDisk <= p.disk);
      if (!eligible) {
        throw new DeploymentQuotaExceeded(`Total volume size ${totalDisk}Gi exceeds the plan's disk limit`);
      }

      if (this.volumeManager.createStorageVolume) {
        await this.volumeManager.createStorageVolume({
          userId: input.userId,
          volumeName: input.name,
          sizeGb: input.sizeGb,
          region: input.region,
        });
      }

      await repo.volumes.save(volume);
      return volume;
    });
  }
}
