import { ScaleRule, type Deployment, type ScaleRuleConfiguration, type ScaleRuleDetails, type User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentOperationConflictError, type DeploymentOperationLock } from "../../ports/deployment-operation-lock.js";
import { ScaleRuleConflictError, ScaleRuleNotFoundError } from "../../ports/scale-rule.js";
import { DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";
import { assertDeploymentOperationLease, withDeploymentOperationLock } from "./with-deployment-operation-lock.js";
import { checkScaleRuleCapacity, validateScaleRuleBounds } from "./scale-rule-capacity.js";

export class ManageScaleRuleCase {
  public constructor(private readonly uow: UnitOfWork, private readonly subscriptions: StripeSubscriptionGateway, private readonly lock: DeploymentOperationLock) {}

  public list(deploymentId: string, userId: string): Promise<ScaleRule[]> {
    return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<ScaleRule[]> => {
      await this.owned(repo, deploymentId, userId);
      const rule: ScaleRule | null = await repo.scaleRules.findByDeploymentId(deploymentId);
      return rule ? [rule] : [];
    });
  }

  public async get(deploymentId: string, userId: string): Promise<ScaleRule> {
    const rules: ScaleRule[] = await this.list(deploymentId, userId);
    if (!rules[0]) throw new ScaleRuleNotFoundError("Scale rule not found");
    return rules[0];
  }

  public save(deploymentId: string, userId: string, configuration: Partial<ScaleRuleConfiguration>, create: boolean): Promise<ScaleRule> {
    return withDeploymentOperationLock(this.lock, deploymentId, "scale-rule", async (signal: AbortSignal): Promise<ScaleRule> => {
      const initial: { readonly user: User; readonly rule: ScaleRule } = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<{ readonly user: User; readonly rule: ScaleRule }> => {
        const deployment: Deployment = await this.owned(repo, deploymentId, userId);
        if (deployment.activeResourceUpdateId) throw new DeploymentOperationConflictError();
        const existing: ScaleRule | null = await repo.scaleRules.findByDeploymentId(deploymentId);
        if (create && existing) throw new ScaleRuleConflictError("A deployment can have only one scale rule");
        if (!create && !existing) throw new ScaleRuleNotFoundError("Scale rule not found");
        const now: Date = new Date();
        const previous: ScaleRuleDetails | undefined = existing?.getDetails();
        const merged: Partial<ScaleRuleConfiguration> = { ...previous, ...configuration };
        const rule: ScaleRule = new ScaleRule({
          deploymentId, createdAt: previous?.createdAt ?? now,
          lastEvaluatedAt: previous?.lastEvaluatedAt ?? null, lastScaledAt: previous?.lastScaledAt ?? null,
          enabled: merged.enabled!, metric: merged.metric!,
          scaleOutThreshold: merged.scaleOutThreshold!, scaleInThreshold: merged.scaleInThreshold!,
          minReplicas: merged.minReplicas!, maxReplicas: merged.maxReplicas!,
          evaluationWindowSeconds: merged.evaluationWindowSeconds!, cooldownSeconds: merged.cooldownSeconds!,
          updatedAt: now, lastAction: "NO_ACTION", lastReason: "configuration_updated",
        });
        if (["SCALING", "DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"].includes(deployment.status)) throw new ScaleRuleConflictError("Deployment is scaling or being deleted");
        validateScaleRuleBounds(deployment, rule.getDetails());
        if (create || rule.getDetails().enabled) {
          if (!["RUNNING", "STOPPED"].includes(deployment.status)) throw new ScaleRuleConflictError("Enable scale rules only on provisioned RUNNING or STOPPED deployments");
        }
        const user: User | null = await repo.users.findById(userId);
        if (!user || !user.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
        return { user, rule };
      });
      const enabled: boolean = initial.rule.getDetails().enabled;
      if (enabled && !initial.user.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
      const products: readonly string[] = enabled ? await this.subscriptions.getActiveSubscriptionProductIds(initial.user.stripeCustomerId!) : [];
      return this.uow.run(async (repo: UnitOfWorkRepositories): Promise<ScaleRule> => {
        assertDeploymentOperationLease(signal);
        const user: User | null = await repo.users.findByIdForUpdate(userId);
        const deployment: Deployment = await this.owned(repo, deploymentId, userId);
        if (deployment.activeResourceUpdateId) throw new DeploymentOperationConflictError();
        if (["SCALING", "DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"].includes(deployment.status)) throw new ScaleRuleConflictError("Deployment changed before saving the scale rule");
        if (enabled) {
          if (!["RUNNING", "STOPPED"].includes(deployment.status)) throw new ScaleRuleConflictError("Deployment changed before saving the scale rule");
          await checkScaleRuleCapacity(repo, user, initial.user.stripeCustomerId!, products, deployment, initial.rule.getDetails());
        } else if (!user || !user.active || user.suspended) throw new DeploymentSubscriptionRequired("An eligible user is required");
        assertDeploymentOperationLease(signal);
        await repo.scaleRules.save(initial.rule);
        return initial.rule;
      });
    });
  }

  public delete(deploymentId: string, userId: string): Promise<void> {
    return withDeploymentOperationLock(this.lock, deploymentId, "scale-rule", async (signal: AbortSignal): Promise<void> => {
      await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
        const deployment: Deployment = await this.owned(repo, deploymentId, userId);
        if (deployment.activeResourceUpdateId) throw new DeploymentOperationConflictError();
        assertDeploymentOperationLease(signal);
        await repo.scaleRules.delete(deploymentId);
      });
    });
  }

  private async owned(repo: UnitOfWorkRepositories, deploymentId: string, userId: string): Promise<Deployment> {
    const deployment: Deployment | null = await repo.deployment.findByIdAndUserId(deploymentId, userId);
    if (!deployment) throw new DeploymentNotFoundError("Deployment not found");
    return deployment;
  }
}
