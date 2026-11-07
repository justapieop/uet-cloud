import { randomUUID } from "node:crypto";
import { Deployment, Permission, ScaleRule, type User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentOperationConflictError, type DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import type { DeploymentMetrics, DeploymentMetricsReader } from "../../ports/monitoring.js";
import type { DeploymentScaler, DeploymentScalingIdentity, DeploymentScalingSnapshot } from "../../ports/scale-rule.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import { CheckPermissionsCase } from "../role/CheckPermissions.case.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";
import { checkScaleRuleCapacity } from "./scale-rule-capacity.js";
import { evaluateScaleRule, scaleRuleWindow, type ScaleDecision } from "./evaluate-scale-rule.js";

export class EvaluateScaleRuleCase {
  public constructor(
    private readonly uow: UnitOfWork, private readonly subscriptions: StripeSubscriptionGateway,
    private readonly metrics: DeploymentMetricsReader, private readonly scaler: DeploymentScaler,
    private readonly lock: DeploymentOperationLock, private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public async exec(deploymentId: string): Promise<ScaleDecision> {
    try {
      return await withDeploymentOperationLock(this.lock, deploymentId, "scale", (signal: AbortSignal): Promise<ScaleDecision> => this.evaluate(deploymentId, signal));
    } catch (error: unknown) {
      if (error instanceof DeploymentOperationConflictError) return this.noAction("operation_in_progress");
      throw error;
    }
  }

  private async evaluate(deploymentId: string, signal: AbortSignal): Promise<ScaleDecision> {
    const initial: { readonly rule: ScaleRule; readonly deployment: Deployment; readonly user: User } | null = await this.uow.run(async (repo: UnitOfWorkRepositories) => {
      const rule: ScaleRule | null = await repo.scaleRules.findByDeploymentId(deploymentId);
      if (!rule?.getDetails().enabled) return null;
      const deployment: Deployment | null = await repo.deployment.findById(deploymentId);
      if (!deployment || deployment.status !== "RUNNING" || !deployment.resourceId || deployment.activeResourceUpdateId) return null;
      const user: User | null = await repo.users.findById(deployment.userId);
      if (!user || !user.active || user.suspended || !await new CheckPermissionsCase(repo.roles).exec(user.id,
        [Permission.DeploymentRead, Permission.DeploymentUpdate, Permission.DeploymentMetricsRead])) return null;
      return { rule, deployment, user };
    });
    if (!initial) return this.noAction("disabled_or_ineligible");
    const rule: ScaleRule = initial.rule;
    const deployment: Deployment = initial.deployment;
    const now: Date = this.now();
    if (rule.getDetails().lastScaledAt && now.getTime() - rule.getDetails().lastScaledAt!.getTime() < rule.getDetails().cooldownSeconds * 1000) {
      return this.record(rule, this.noAction("cooldown"), signal);
    }
    const identity: DeploymentScalingIdentity = { deploymentId, userId: deployment.userId, appName: deployment.name, resourceId: deployment.resourceId! };
    let snapshot: DeploymentScalingSnapshot;
    let metrics: DeploymentMetrics;
    try {
      snapshot = await this.scaler.inspect(identity, signal);
      const window: ReturnType<typeof scaleRuleWindow> = scaleRuleWindow(now, rule.getDetails().evaluationWindowSeconds);
      metrics = await this.metrics.read({ ...identity, start: window.start, end: window.end });
    } catch {
      return this.record(rule, this.noAction("monitoring_or_capacity_unavailable"), signal);
    }
    const decision: ScaleDecision = evaluateScaleRule(rule.getDetails(), deployment, snapshot, metrics, now);
    if (decision.action === "NO_ACTION") return this.record(rule, decision, signal);
    let claimed: boolean = false;
    try {
      if (!initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
      const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.user.stripeCustomerId);
      claimed = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<boolean> => {
        const user: User | null = await repo.users.findByIdForUpdate(deployment.userId);
        const current: Deployment | null = await repo.deployment.findByIdAndUserId(deploymentId, deployment.userId);
        if (!current || current.status !== "RUNNING" || current.activeResourceUpdateId || current.resourceId !== deployment.resourceId || current.updatedAt.getTime() !== deployment.updatedAt.getTime()) return false;
        await checkScaleRuleCapacity(repo, user, initial.user.stripeCustomerId!, products, current, rule.getDetails(), snapshot);
        if (!await new CheckPermissionsCase(repo.roles).exec(deployment.userId,
          [Permission.DeploymentRead, Permission.DeploymentUpdate, Permission.DeploymentMetricsRead])) return false;
        assertDeploymentOperationLease(signal);
        return repo.deployment.transitionStatus(deploymentId, deployment.userId, "RUNNING", "SCALING");
      });
    } catch (error: unknown) {
      return this.record(rule, this.noAction(error instanceof DeploymentQuotaExceeded ? "quota_exceeded" : "subscription_unavailable_or_ineligible"), signal);
    }
    if (!claimed) return this.record(rule, this.noAction("deployment_changed"), signal);
    try {
      assertDeploymentOperationLease(signal);
      await this.scaler.scale({ ...identity, expected: snapshot, targetReplicas: decision.targetReplicas!, operationId: randomUUID() }, signal);
      assertDeploymentOperationLease(signal);
      await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
        assertDeploymentOperationLease(signal);
        if (!await repo.deployment.transitionStatus(deploymentId, deployment.userId, "SCALING", "RUNNING")) throw new Error("Scaling state changed");
        assertDeploymentOperationLease(signal);
        await repo.scaleRules.save(new ScaleRule({ ...rule.getDetails(), lastEvaluatedAt: this.now(), lastScaledAt: this.now(), lastAction: decision.action, lastReason: decision.reason }));
        assertDeploymentOperationLease(signal);
      });
      return decision;
    } catch {
      // A timeout may have reached ARM. Fail closed: do not resubmit an
      // uncertain write or report success. Redeploy/operator review recovers it.
      await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
        await repo.deployment.updateProgress(new Deployment({ ...deployment.getDetails(), status: "FAILED", error: "Scaling failed or could not be confirmed; inspect Azure before recovery", updatedAt: this.now() }), { expectedStatus: "SCALING" });
        assertDeploymentOperationLease(signal);
        await repo.scaleRules.save(new ScaleRule({ ...rule.getDetails(), lastEvaluatedAt: this.now(), lastAction: "NO_ACTION", lastReason: "scaling_failed_or_unconfirmed" }));
      });
      return this.noAction("scaling_failed_or_unconfirmed");
    }
  }

  private async record(rule: ScaleRule, decision: ScaleDecision, signal: AbortSignal): Promise<ScaleDecision> {
    assertDeploymentOperationLease(signal);
    await this.uow.run((repo: UnitOfWorkRepositories): Promise<void> => repo.scaleRules.save(new ScaleRule({
      ...rule.getDetails(), lastEvaluatedAt: this.now(), lastAction: decision.action, lastReason: decision.reason,
    })));
    return decision;
  }

  private noAction(reason: string): ScaleDecision { return { action: "NO_ACTION", targetReplicas: null, reason, metricValue: null }; }
}
