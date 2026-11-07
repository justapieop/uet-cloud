import { InvalidDomainParams, type Deployment, type Plan, type ScaleRuleConfiguration, type User } from "@kumo/domain";
import type { UnitOfWorkRepositories } from "../../ports/uow.js";
import type { DeploymentScalingSnapshot } from "../../ports/scale-rule.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired } from "../../ports/stripe.js";

export function validateScaleRuleBounds(deployment: Deployment, rule: ScaleRuleConfiguration): void {
  if (!deployment.spec || !deployment.resourceId) throw new InvalidDomainParams("Scale rules require a provisioned deployment with a saved specification");
  if (rule.maxReplicas > deployment.spec.maxScaling || rule.minReplicas < deployment.spec.minScaling) {
    throw new DeploymentQuotaExceeded("Scale rule limits must stay within the deployment's reserved min_scaling/max_scaling");
  }
}

export async function checkScaleRuleCapacity(
  repo: UnitOfWorkRepositories, user: User | null, customerId: string, products: readonly string[],
  deployment: Deployment, rule: ScaleRuleConfiguration, snapshot?: DeploymentScalingSnapshot,
): Promise<void> {
  if (!user || !user.active || user.suspended || user.stripeCustomerId !== customerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
  validateScaleRuleBounds(deployment, rule);
  const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
  if (!plans.length) throw new DeploymentSubscriptionRequired("An active subscription linked to an active Kumo plan is required");
  const count: number = await repo.deployment.countReservedByUserId(user.id);
  if (!plans.some((plan: Plan): boolean => count <= plan.deployments &&
    Math.max(deployment.spec!.maxVcpu, snapshot?.cpuCores ?? 0) <= plan.vcpu &&
    Math.max(deployment.spec!.maxMemory, snapshot?.memoryGiB ?? 0) <= plan.memory &&
    deployment.spec!.maxScaling <= plan.maxReplicas)) throw new DeploymentQuotaExceeded("Deployment exceeds current plan limits");
}
