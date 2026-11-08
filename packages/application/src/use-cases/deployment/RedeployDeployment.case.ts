import { createHash } from "node:crypto";
import { Deployment, InvalidDomainParams, type User, type Plan } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentConfigurationReadError, type DeploymentConfiguration, type DeploymentConfigurationReader } from "../../ports/deployment-configuration.js";
import type { DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import { VolumeOperationCoordinator } from "../../ports/volume.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../../ports/deployment-request.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";

interface RedeploymentAdmission { readonly user: User; readonly deployment: Deployment; }

export class RedeployDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
    private readonly configuration?: DeploymentConfigurationReader,
    private readonly operationLock: DeploymentOperationLock = new VolumeOperationCoordinator(),
  ) {}

  public async exec(id: string, userId: string, key: string): Promise<Deployment> {
    if (!/^[\x20-\x7e]{1,255}$/.test(key)) throw new InvalidDomainParams("Invalid Idempotency-Key");
    const keyHash: string = createHash("sha256").update(JSON.stringify([userId, "deployment.redeploy", id, key])).digest("hex");
    const fingerprint: string = createHash("sha256").update(JSON.stringify([id, "redeploy"])).digest("hex");
    const initial: Deployment | RedeploymentAdmission = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment | RedeploymentAdmission> => {
      const user: User | null = await repo.users.findById(userId);
      if (!user || !user.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(id, userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
      if (receipt) {
        this.assertFingerprint(receipt, fingerprint);
        return new Deployment(receipt.deployment);
      }
      this.assertAvailable(deployment);
      return { user, deployment };
    });
    if (initial instanceof Deployment) return initial;
    if (!initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
    if (!this.configuration) throw new DeploymentConfigurationReadError("unavailable");
    // Both network calls finish before acquiring the admission transaction's row locks.
    const applied: DeploymentConfiguration = await this.configuration.read({ resourceId: initial.deployment.resourceId!, deploymentId: id, userId, appName: initial.deployment.name });
    if (!applied.configurationVersion || applied.maxVcpu === null || applied.maxMemory === null || applied.maxScaling === null) {
      throw new InvalidDeploymentStatusError("RESOURCE_BASELINE_UNSETTLED: Redeployment requires a verified stable applied configuration");
    }
    const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.user.stripeCustomerId);
    return withDeploymentOperationLock(this.operationLock, id, "redeploy", (signal: AbortSignal): Promise<Deployment> =>
      this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment> => {
        assertDeploymentOperationLease(signal);
        const user: User | null = await repo.users.findByIdForUpdate(userId);
        if (!user || !user.active || user.suspended || user.stripeCustomerId !== initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
        const deployment: Deployment | null = repo.deployment.findByIdAndUserIdForUpdate
          ? await repo.deployment.findByIdAndUserIdForUpdate(id, userId) : await repo.deployment.findByIdAndUserId(id, userId);
        if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
        const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
        if (receipt) {
          this.assertFingerprint(receipt, fingerprint);
          return new Deployment(receipt.deployment);
        }
        this.assertAvailable(deployment);
        if (deployment.resourceId !== initial.deployment.resourceId || deployment.name !== initial.deployment.name) throw new InvalidDeploymentStatusError("Deployment identity changed");
        const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
        if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
        const count: number = await repo.deployment.countReservedByUserId(userId);
        if (!plans.some((plan: Plan): boolean => count <= plan.deployments && applied.maxVcpu! <= plan.vcpu &&
          applied.maxMemory! <= plan.memory && applied.maxScaling! <= plan.maxReplicas)) throw new DeploymentQuotaExceeded("Existing deployment exceeds current plan limits");
        assertDeploymentOperationLease(signal);
        if (!await repo.deployment.transitionStatus(id, userId, deployment.status, "PENDING")) throw new InvalidDeploymentStatusError("Deployment changed; retry with a fresh request");
        const queued: Deployment = new Deployment({ ...deployment.getDetails(), status: "PENDING", buildId: null, error: null, updatedAt: new Date() });
        await repo.deployment.updateProgress(queued);
        await repo.deploymentRequests.save(keyHash, { fingerprint, deployment: { ...queued.getDetails(), spec: { ...queued.spec!, envVars: undefined } } });
        return queued;
      }));
  }

  private assertFingerprint(receipt: DeploymentRequestReceipt, fingerprint: string): void {
    if (receipt.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used");
  }

  private assertAvailable(deployment: Deployment): void {
    if (deployment.activeResourceUpdateId || !deployment.spec || !deployment.resourceId || !["RUNNING", "FAILED"].includes(deployment.status)) {
      throw new InvalidDeploymentStatusError("Redeploy requires an idle provisioned RUNNING deployment or a failed deployment retaining its Azure resource");
    }
  }
}
