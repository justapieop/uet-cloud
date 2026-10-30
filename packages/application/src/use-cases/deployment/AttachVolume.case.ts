import {
  Deployment,
  InvalidDomainParams,
  validateDeploymentVolumes,
  Volume,
  type DeploymentSpec,
  type DeploymentVolume,
  type Plan,
  type User,
} from "@kumo/domain";
import { randomUUID } from "node:crypto";
import { DeploymentNotFoundError, type VolumeManager } from "../../ports/deployment.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export interface AttachVolumeInput {
  readonly userId: string;
  readonly deploymentId: string;
  readonly volume: DeploymentVolume;
}

export class AttachVolumeCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
    private readonly volumeManager: VolumeManager,
  ) {}

  public async exec(input: AttachVolumeInput): Promise<Deployment> {
    const validationError: InvalidDomainParams | null = validateDeploymentVolumes([input.volume]);
    if (validationError) throw validationError;

    const initialUser: User = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<User> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      if (deployment.status !== "RUNNING" && deployment.status !== "STOPPED") {
        throw new InvalidDeploymentStatusError("Deployment must be in RUNNING or STOPPED state to attach volume");
      }
      if (!deployment.resourceId) {
        throw new InvalidDeploymentStatusError("Deployment has no provisioned Azure resource");
      }
      if (!deployment.spec) {
        throw new InvalidDeploymentStatusError("Deployment has no configuration specification");
      }
      const existingVolumes: readonly DeploymentVolume[] = deployment.spec.volumes ?? [];
      if (existingVolumes.some((v: DeploymentVolume): boolean => v.name === input.volume.name)) {
        throw new InvalidDomainParams(`Volume name '${input.volume.name}' already exists in deployment`);
      }
      const normalizedPath: string = input.volume.mountPath.replace(/\/+$/, "") || "/";
      if (existingVolumes.some((v: DeploymentVolume): boolean => (v.mountPath.replace(/\/+$/, "") || "/") === normalizedPath)) {
        throw new InvalidDomainParams(`Volume mountPath '${normalizedPath}' is already mounted in deployment`);
      }
      return user;
    });

    if (!initialUser.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription linked to a Kumo plan is required");
    const productIds: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initialUser.stripeCustomerId);

    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
      const user: User | null = await repo.users.findByIdForUpdate(input.userId);
      if (!user || user.suspended || user.stripeCustomerId !== initialUser.stripeCustomerId) {
        throw new DeploymentSubscriptionRequired("The user or billing association changed; retry the request");
      }
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(input.deploymentId, input.userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      if (deployment.status !== "RUNNING" && deployment.status !== "STOPPED") {
        throw new InvalidDeploymentStatusError("Deployment must be in RUNNING or STOPPED state to attach volume");
      }
      if (!deployment.resourceId || !deployment.spec) {
        throw new InvalidDeploymentStatusError("Deployment has no provisioned Azure resource");
      }
      const existingVolumes: readonly DeploymentVolume[] = deployment.spec.volumes ?? [];
      const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(productIds);
      if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
      const totalDisk: number = existingVolumes.reduce((sum: number, v: DeploymentVolume): number => sum + v.sizeGb, 0) + input.volume.sizeGb;
      const eligible: boolean = plans.some((p: Plan): boolean => totalDisk <= p.disk);
      if (!eligible) throw new DeploymentQuotaExceeded(`Total volume size ${totalDisk}Gi exceeds the plan's disk limit`);

      await this.volumeManager.attachVolume({
        userId: input.userId,
        appName: deployment.name,
        deploymentId: deployment.id,
        resourceId: deployment.resourceId,
        volume: input.volume,
        existingVolumes,
      });

      const existingVolRecord: Volume | null = await repo.volumes.findByNameAndUserId(input.volume.name, input.userId);
      if (!existingVolRecord) {
        const newVolRecord: Volume = new Volume({
          id: randomUUID(),
          userId: input.userId,
          name: input.volume.name,
          sizeGb: input.volume.sizeGb,
          region: deployment.spec?.region ?? "eastus2",
        });
        await repo.volumes.save(newVolRecord);
      }

      const updatedVolumes: readonly DeploymentVolume[] = [...existingVolumes, input.volume];
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
