import { type Deployment, type DeploymentResourceUpdate, type Plan, type User } from "@kumo/domain";
import type { DeploymentConfigurationUpdater, DeploymentResourceApplyResult, DeploymentResourceReconcileResult } from "../../ports/deployment-configuration.js";
import { DeploymentOperationConflictError, DeploymentOperationLeaseLostError, type DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import { DeploymentResourceUpdateError, type DeploymentResourceUpdateProgress, type DeploymentResourceUpdateQueueRepository } from "../../ports/deployment-resource-update.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";
import { assertResourcePlan, resourceUpdateRepository } from "./UpdateDeploymentResources.case.js";

export class ProcessDeploymentResourceUpdateCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly subscriptions: StripeSubscriptionGateway,
    private readonly updater: DeploymentConfigurationUpdater,
    private readonly lock: DeploymentOperationLock,
    private readonly queue: DeploymentResourceUpdateQueueRepository,
  ) {}

  public async exec(update: DeploymentResourceUpdate, abortSignal?: AbortSignal): Promise<void> {
    if (!update.claimToken || (update.status !== "APPLYING" && update.status !== "RECONCILING")) return;
    const claimToken: string = update.claimToken;
    let writeMayHaveStarted: boolean = update.targetRevision !== null;
    const progress: (fields: Omit<DeploymentResourceUpdateProgress, "operationId" | "userId" | "claimToken" | "expectedStatus">) => Promise<boolean> = async (fields: Omit<DeploymentResourceUpdateProgress, "operationId" | "userId" | "claimToken" | "expectedStatus">): Promise<boolean> => this.queue.updateClaimed({ operationId: update.id, userId: update.userId, claimToken, expectedStatus: update.status, ...fields });
    try {
      await withDeploymentOperationLock(this.lock, update.deploymentId, "configure", async (leaseSignal: AbortSignal): Promise<void> => {
        const signal: AbortSignal = abortSignal ? AbortSignal.any([leaseSignal, abortSignal]) : leaseSignal;
        assertDeploymentOperationLease(signal);
        const deployment: Deployment | null = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment | null> => {
          const current: DeploymentResourceUpdate | null = await resourceUpdateRepository(repo).findByIdAndUserId(update.id, update.userId);
          if (!current || current.claimToken !== claimToken || current.status !== update.status) return null;
          const found: Deployment | null = await repo.deployment.findByIdAndUserId(update.deploymentId, update.userId);
          if (!found || found.activeResourceUpdateId !== update.id) return null;
          return found;
        });
        if (!deployment) return;
        if (!deployment.resourceId || deployment.resourceId.toLowerCase() !== update.baseline.resourceId.toLowerCase() || deployment.status !== update.lifecycle) {
          throw new DeploymentResourceUpdateError("RESOURCE_DEPLOYMENT_CHANGED", "Deployment identity or lifecycle changed during the resource update", writeMayHaveStarted || update.status === "RECONCILING");
        }
        const identity: { readonly resourceId: string; readonly deploymentId: string; readonly userId: string; readonly appName: string } = {
          resourceId: deployment.resourceId, deploymentId: update.deploymentId, userId: update.userId, appName: deployment.name,
        };
        if (update.status === "RECONCILING") {
          // The updater cannot submit ARM until its target marker is durably fenced.
          // An absent marker therefore proves this command never submitted a write.
          if (update.targetRevision === null) {
            await progress({ status: "FAILED", errorCode: "RESOURCE_WRITE_NOT_SUBMITTED", errorMessage: "The worker stopped before submitting the Azure resource update" });
            return;
          }
          const result: DeploymentResourceReconcileResult = await this.updater.reconcile({ ...identity, operationId: update.id, baseline: update.baseline, requested: update.requested, lifecycle: update.lifecycle, targetRevision: update.targetRevision, abortSignal: signal });
          assertDeploymentOperationLease(signal);
          if (result.outcome === "succeeded") {
            await progress({ status: "SUCCEEDED", observed: result.observed, targetRevision: result.targetRevision, noOp: result.noOp, errorCode: null, errorMessage: null });
          } else if (result.outcome === "failed") {
            await progress({ status: "FAILED", observed: result.observed ?? null, targetRevision: result.targetRevision ?? update.targetRevision, errorCode: result.errorCode, errorMessage: result.errorMessage });
          } else {
            await progress({ status: "RECONCILING", observed: result.observed ?? null, targetRevision: result.targetRevision ?? update.targetRevision, releaseClaim: true, retryAfterMs: 10_000 });
          }
          return;
        }
        if (update.lifecycle === "STOPPED" && !this.updater.supportsStopped) throw new DeploymentResourceUpdateError("RESOURCE_STOPPED_UNSUPPORTED", "Stopped deployment resource updates have not been verified on Azure");
        const user: User | null = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<User | null> => repo.users.findById(update.userId));
        if (!user || !user.active || user.suspended || user.stripeCustomerId !== update.billingCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
        const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(update.billingCustomerId);
        const eligible: boolean = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<boolean> => {
          const currentUser: User | null = await repo.users.findByIdForUpdate(update.userId);
          if (!currentUser || !currentUser.active || currentUser.suspended || currentUser.stripeCustomerId !== update.billingCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
          if (!repo.deployment.findByIdAndUserIdForUpdate) throw new DeploymentResourceUpdateError("RESOURCE_UPDATES_UNAVAILABLE", "Resource update locking is unavailable");
          const currentDeployment: Deployment | null = await repo.deployment.findByIdAndUserIdForUpdate(update.deploymentId, update.userId);
          const current: DeploymentResourceUpdate | null = await resourceUpdateRepository(repo).findByIdAndUserId(update.id, update.userId);
          if (!current || current.claimToken !== claimToken || current.status !== "APPLYING") return false;
          if (!currentDeployment || currentDeployment.activeResourceUpdateId !== update.id || currentDeployment.status !== update.lifecycle || currentDeployment.resourceId !== deployment.resourceId) throw new DeploymentResourceUpdateError("RESOURCE_DEPLOYMENT_CHANGED", "Deployment changed before the resource write");
          const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
          assertResourcePlan(plans, update.requested);
          assertDeploymentOperationLease(signal);
          return true;
        });
        if (!eligible) return;
        assertDeploymentOperationLease(signal);
        const result: DeploymentResourceApplyResult = await this.updater.update({
          ...identity, operationId: update.id, baseline: update.baseline, requested: update.requested, lifecycle: update.lifecycle, abortSignal: signal,
          onTargetRevision: async (targetRevision: string): Promise<void> => {
            assertDeploymentOperationLease(signal);
            if (!await progress({ status: "APPLYING", targetRevision })) throw new DeploymentOperationLeaseLostError();
            writeMayHaveStarted = true;
            assertDeploymentOperationLease(signal);
          },
        });
        assertDeploymentOperationLease(signal);
        await progress({ status: "SUCCEEDED", observed: result.observed, targetRevision: result.targetRevision, noOp: result.noOp, errorCode: null, errorMessage: null });
      });
    } catch (error: unknown) {
      if (error instanceof DeploymentOperationConflictError) {
        await progress({ status: update.status === "RECONCILING" ? "RECONCILING" : "PENDING", releaseClaim: true, retryAfterMs: 2_000 });
        return;
      }
      const unknown: boolean = update.status === "RECONCILING" || error instanceof DeploymentOperationLeaseLostError || (error instanceof DeploymentResourceUpdateError ? error.outcomeUnknown : writeMayHaveStarted);
      const code: string = error instanceof DeploymentResourceUpdateError ? error.code : error instanceof DeploymentQuotaExceeded ? "RESOURCE_QUOTA_EXCEEDED" : error instanceof DeploymentSubscriptionRequired ? "RESOURCE_SUBSCRIPTION_REQUIRED" : error instanceof SubscriptionCheckUnavailable ? "RESOURCE_BILLING_UNAVAILABLE" : unknown ? "RESOURCE_OUTCOME_UNKNOWN" : "RESOURCE_UPDATE_FAILED";
      const message: string = error instanceof DeploymentResourceUpdateError || error instanceof DeploymentQuotaExceeded || error instanceof DeploymentSubscriptionRequired ? error.message : unknown ? "The Azure update outcome is being reconciled" : "Unable to apply the resource update";
      await progress({
        status: unknown ? "RECONCILING" : "FAILED", errorCode: code, errorMessage: message,
        ...(error instanceof DeploymentResourceUpdateError && error.context ? error.context : {}),
        ...(unknown ? { releaseClaim: true, retryAfterMs: 10_000 } : {}),
      });
    }
  }
}
