import { createHash } from "node:crypto";
import { Deployment, InvalidDomainParams, type User, type Plan } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../../ports/deployment-request.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";

export class RedeployDeploymentCase {
  public constructor(private readonly uow: UnitOfWork, private readonly subscriptions: StripeSubscriptionGateway) {}

  public async exec(id: string, userId: string, key: string): Promise<Deployment> {
    if (!/^[\x20-\x7e]{1,255}$/.test(key)) throw new InvalidDomainParams("Invalid Idempotency-Key");
    const keyHash: string = createHash("sha256").update(JSON.stringify([userId, "deployment.redeploy", id, key])).digest("hex");
    const fingerprint: string = createHash("sha256").update(JSON.stringify([id, "redeploy"])).digest("hex");
    const initial: Deployment | User = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment | User> => {
      const user: User | null = await repo.users.findById(userId);
      if (!user || !user.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(id, userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used");
        return new Deployment(receipt.deployment);
      }
      return user;
    });
    if (initial instanceof Deployment) return initial;
    if (!initial.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
    const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.stripeCustomerId);
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
      const user: User | null = await repo.users.findByIdForUpdate(userId);
      if (!user || !user.active || user.suspended || user.stripeCustomerId !== initial.stripeCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(id, userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
      if (receipt) return new Deployment(receipt.deployment);
      if (!deployment.spec || !deployment.resourceId || !["RUNNING", "FAILED"].includes(deployment.status)) {
        throw new InvalidDeploymentStatusError("Redeploy requires a provisioned RUNNING deployment or a failed deployment retaining its Azure resource");
      }
      const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
      if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
      const count: number = await repo.deployment.countReservedByUserId(userId);
      if (!plans.some((plan: Plan): boolean => count <= plan.deployments && deployment.spec!.maxVcpu <= plan.vcpu &&
        deployment.spec!.maxMemory <= plan.memory && deployment.spec!.maxScaling <= plan.maxReplicas)) throw new DeploymentQuotaExceeded("Existing deployment exceeds current plan limits");
      if (!await repo.deployment.transitionStatus(id, userId, deployment.status, "PENDING")) throw new InvalidDeploymentStatusError("Deployment changed; retry with a fresh request");
      const queued: Deployment = new Deployment({ ...deployment.getDetails(), status: "PENDING", buildId: null, error: null, updatedAt: new Date() });
      await repo.deployment.updateProgress(queued);
      await repo.deploymentRequests.save(keyHash, { fingerprint, deployment: { ...queued.getDetails(), spec: { ...queued.spec!, envVars: undefined } } });
      return queued;
    });
  }
}
