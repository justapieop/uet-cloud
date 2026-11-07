import { createHash, randomUUID } from "node:crypto";
import { DeploymentResourceConfiguration, DeploymentResourceUpdate, InvalidDomainParams, type Deployment, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails, type DeploymentResourceUpdateReceipt, type Plan, type User } from "@kumo/domain";
import type { DeploymentConfigurationUpdater } from "../../ports/deployment-configuration.js";
import { DeploymentOperationConflictError, type DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import { DeploymentRequestKeyReused } from "../../ports/deployment-request.js";
import { DeploymentResourceUpdateError, DeploymentResourceVersionMismatch, DeploymentResourceVersionRequired, type DeploymentResourceUpdateRepository } from "../../ports/deployment-resource-update.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";

export function resourceUpdateRepository(repo: UnitOfWorkRepositories): DeploymentResourceUpdateRepository {
  if (!repo.deploymentResourceUpdates) throw new DeploymentResourceUpdateError("RESOURCE_UPDATES_UNAVAILABLE", "Resource update storage is unavailable");
  return repo.deploymentResourceUpdates;
}
export function assertResourcePlan(plans: readonly Plan[], requested: DeploymentResourceConfigurationDetails): void {
  if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
  if (!plans.some((plan: Plan): boolean => requested.maxVcpu <= plan.vcpu && requested.maxMemory <= plan.memory && requested.maxScaling <= plan.maxReplicas)) {
    throw new DeploymentQuotaExceeded("Requested resources exceed current plan limits");
  }
}
function assertLifecycle(deployment: Deployment, updater: DeploymentConfigurationUpdater): void {
  if (!deployment.resourceId || (deployment.status !== "RUNNING" && deployment.status !== "STOPPED")) {
    throw new DeploymentResourceUpdateError("RESOURCE_LIFECYCLE_UNSUPPORTED", "Resource updates require a provisioned running or stopped deployment");
  }
  if (deployment.status === "STOPPED" && !updater.supportsStopped) {
    throw new DeploymentResourceUpdateError("RESOURCE_STOPPED_UNSUPPORTED", "Resource updates for stopped deployments are unavailable until Azure stop preservation has been verified");
  }
}
export class UpdateDeploymentResourcesCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
    private readonly updater: DeploymentConfigurationUpdater,
    private readonly lock: DeploymentOperationLock,
    // Retain the former constructor argument for existing callers; rollout gates no longer authorize edits.
    _legacyAdmissionGate?: () => boolean,
    private readonly onStateChanged?: (userId: string) => Promise<void>,
  ) {}

  public async exec(id: string, userId: string, key: string, ifMatch: string | undefined, input: DeploymentResourceConfigurationDetails): Promise<DeploymentResourceUpdateReceipt> {
    const requested: DeploymentResourceConfigurationDetails = new DeploymentResourceConfiguration(input).getDetails();
    if (typeof key !== "string" || !/^[\x20-\x7e]{1,255}$/.test(key)) throw new InvalidDomainParams("Invalid Idempotency-Key");
    if (ifMatch === undefined || ifMatch === "") throw new DeploymentResourceVersionRequired("If-Match is required");
    if (typeof ifMatch !== "string" || !/^[\x21-\x7e]{1,255}$/.test(ifMatch) || ifMatch === "*" || ifMatch.startsWith("W/") || ifMatch.includes(",")) throw new InvalidDomainParams("Invalid If-Match");
    const version: string = ifMatch.startsWith('"') && ifMatch.endsWith('"') ? ifMatch.slice(1, -1) : ifMatch;
    const keyHash: string = createHash("sha256").update(JSON.stringify([userId, "deployment.resources", id, key])).digest("hex");
    const fingerprint: string = createHash("sha256").update(JSON.stringify([requested.maxVcpu, requested.maxMemory, requested.minScaling, requested.maxScaling, version])).digest("hex");
    const initial: { readonly user: User; readonly deployment: Deployment; readonly replay: DeploymentResourceUpdateReceipt | null } = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<{ readonly user: User; readonly deployment: Deployment; readonly replay: DeploymentResourceUpdateReceipt | null }> => {
      const user: User | null = await repo.users.findById(userId);
      if (!user || !user.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
      const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(id, userId);
      if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
      const existing: DeploymentResourceUpdate | null = await resourceUpdateRepository(repo).findByKeyHash(keyHash);
      if (existing && existing.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used with a different request");
      if (existing && (existing.userId !== userId || existing.deploymentId !== id)) throw new DeploymentNotFoundError("Deployment not found");
      return { user, deployment, replay: existing?.receipt ?? null };
    });
    if (initial.replay) return initial.replay;
    assertLifecycle(initial.deployment, this.updater);
    if (!initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
    const baseline: DeploymentResourceBaseline = await this.updater.readBaseline({ resourceId: initial.deployment.resourceId!, deploymentId: id, userId, appName: initial.deployment.name });
    if (baseline.version !== version) throw new DeploymentResourceVersionMismatch("The applied deployment configuration changed; refresh and retry");
    if (baseline.runningStatus !== (initial.deployment.status === "STOPPED" ? "Stopped" : "Running")) throw new DeploymentResourceUpdateError("RESOURCE_BASELINE_UNSETTLED", "Azure lifecycle does not match the deployment lifecycle");
    const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.user.stripeCustomerId);
    let accepted: boolean = false;
    const receipt: DeploymentResourceUpdateReceipt = await withDeploymentOperationLock(this.lock, id, "configure", async (signal: AbortSignal): Promise<DeploymentResourceUpdateReceipt> => {
      assertDeploymentOperationLease(signal);
      return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<DeploymentResourceUpdateReceipt> => {
        const user: User | null = await repo.users.findByIdForUpdate(userId);
        if (!user || !user.active || user.suspended || user.stripeCustomerId !== initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
        if (!repo.deployment.findByIdAndUserIdForUpdate || !repo.deployment.setActiveResourceUpdate) throw new DeploymentResourceUpdateError("RESOURCE_UPDATES_UNAVAILABLE", "Resource update locking is unavailable");
        const deployment: Deployment | null = await repo.deployment.findByIdAndUserIdForUpdate(id, userId);
        if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
        const commands: DeploymentResourceUpdateRepository = resourceUpdateRepository(repo);
        const existing: DeploymentResourceUpdate | null = await commands.findByKeyHash(keyHash);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used with a different request");
          if (existing.userId !== userId || existing.deploymentId !== id) throw new DeploymentNotFoundError("Deployment not found");
          return existing.receipt;
        }
        if (deployment.status !== initial.deployment.status || deployment.resourceId !== initial.deployment.resourceId || deployment.name !== initial.deployment.name) throw new DeploymentResourceUpdateError("RESOURCE_DEPLOYMENT_CHANGED", "Deployment changed while accepting the update");
        assertLifecycle(deployment, this.updater);
        if (deployment.activeResourceUpdateId) throw new DeploymentOperationConflictError();
        const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
        assertResourcePlan(plans, requested);
        assertDeploymentOperationLease(signal);
        const operationId: string = randomUUID();
        const receipt: DeploymentResourceUpdateReceipt = { operationId, deploymentId: id, status: "PENDING", requested };
        const update: DeploymentResourceUpdate = new DeploymentResourceUpdate({
          id: operationId, deploymentId: id, userId, keyHash, fingerprint, requested, baseline,
          lifecycle: deployment.status as "RUNNING" | "STOPPED", billingCustomerId: user.stripeCustomerId!, status: "PENDING",
          claimToken: null, claimExpiresAt: null, heartbeatAt: null, targetRevision: null, observed: null, noOp: null,
          errorCode: null, errorMessage: null, receipt, createdAt: new Date(), startedAt: null, completedAt: null,
        });
        await commands.insert(update);
        if (!await repo.deployment.setActiveResourceUpdate(id, userId, operationId)) throw new DeploymentOperationConflictError();
        accepted = true;
        return receipt;
      });
    });
    if (accepted && this.onStateChanged) {
      // Cache availability must not turn a committed durable receipt into an HTTP failure.
      try { await this.onStateChanged(userId); } catch {}
    }
    return receipt;
  }
}
