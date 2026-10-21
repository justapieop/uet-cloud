import { createHash, randomUUID } from "node:crypto";
import { Deployment, InvalidDomainParams, type DeploymentSpec, type Plan, type User } from "@kumo/domain";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../../ports/deployment-request.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface CreateDeploymentInput {
  userId: string;
  name: string;
  spec: DeploymentSpec;
  idempotencyKey?: string;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
  ) { }
  
  public async exec(input: CreateDeploymentInput): Promise<Deployment> {
    if (!input.spec) throw new InvalidDomainParams("A deployment creation specification is required");
    const deployment: Deployment = new Deployment({
      id: randomUUID(), name: input.name, userId: input.userId, spec: input.spec, status: "PENDING",
    });
    let keyHash: string | undefined;
    let fingerprint: string | undefined;
    if (input.idempotencyKey !== undefined) {
      if (!/^[\x20-\x7e]{1,255}$/.test(input.idempotencyKey)) throw new InvalidDomainParams("Invalid Idempotency-Key");
      keyHash = createHash("sha256").update(JSON.stringify([input.userId, "deployment.create", input.idempotencyKey])).digest("hex");
      fingerprint = createHash("sha256").update(JSON.stringify({ name: input.name, spec: input.spec },
        (_key: string, value: unknown): unknown => {
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const record: Record<string, unknown> = value as Record<string, unknown>;
            return Object.fromEntries(Object.keys(record).sort().map((key: string): [string, unknown] => [key, record[key]]));
          }
          return value;
        })).digest("hex");
    }

    const initial: Deployment | User = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment | User> => {
      const user: User | null = await repo.users.findById(input.userId);
      if (!user || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      return await this.replay(repo, keyHash, fingerprint) ?? user;
    });
    if (initial instanceof Deployment) return initial;
    if (!initial.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription linked to a Kumo plan is required");
    // Stripe must be queried outside the acceptance transaction and its quota lock.
    const productIds: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.stripeCustomerId);

    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
      // Serialize quota checks and inserts across processes for the same user.
      const user: User | null = await repo.users.findByIdForUpdate(input.userId);
      if (!user || user.suspended || user.stripeCustomerId !== initial.stripeCustomerId) {
        throw new DeploymentSubscriptionRequired("The user or billing association changed; retry the request");
      }
      const replayed: Deployment | null = await this.replay(repo, keyHash, fingerprint);
      if (replayed) return replayed;
      const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(productIds);
      if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
      const existing: Deployment[] = await repo.deployment.findByUserId(input.userId);
      const reservedCount: number = existing.filter((item: Deployment): boolean =>
        item.status === "PENDING" || item.status === "PROVISIONING" || item.status === "RUNNING" ||
        (item.status === "FAILED" && item.resourceId !== null)).length;
      // Each plan must independently cover the request; multiple subscriptions do not stack quotas.
      const eligible: boolean = plans.some((plan: Plan): boolean =>
        reservedCount + 1 <= plan.deployments && input.spec.maxVcpu <= plan.vcpu &&
        input.spec.maxMemory <= plan.memory && input.spec.maxScaling <= plan.maxReplicas);
      if (!eligible) throw new DeploymentQuotaExceeded("The request exceeds the plan's deployment-count, per-deployment CPU, RAM, or replica limit");

      await repo.deployment.save(deployment);
      if (keyHash && fingerprint) {
        await repo.deploymentRequests.save(keyHash, {
          fingerprint, deployment: { ...deployment.getDetails(), spec: { ...input.spec, envVars: undefined } },
        });
      }
      return deployment;
    });
  }

  private async replay(repo: UnitOfWorkRepositories, keyHash?: string, fingerprint?: string): Promise<Deployment | null> {
    if (!keyHash) return null;
    const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used with a different deployment request");
    return new Deployment(receipt.deployment);
  }
}
