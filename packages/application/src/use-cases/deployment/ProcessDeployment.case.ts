import { Deployment, type DeploymentDetails, type DeploymentResourceBaseline, type Plan, type User } from "@kumo/domain";
import { BuildAccessDenied, BuildProviderError, InvalidBuildInput } from "../../ports/build.js";
import { DeploymentProgressConflictError, type DeploymentProgressOptions, type DeploymentProvisioner, type DeploymentProvisionResult, type DeploymentRepository } from "../../ports/deployment.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, type StripeSubscriptionGateway } from "../../ports/stripe.js";

export class ProcessDeploymentCase {
  public constructor(
    private readonly repository: DeploymentRepository,
    private readonly provisioner: DeploymentProvisioner,
    private readonly uow?: UnitOfWork,
    private readonly subscriptions?: StripeSubscriptionGateway,
  ) {}

  public async exec(deployment: Deployment): Promise<void> {
    if (deployment.status !== "PROVISIONING" || !deployment.spec) throw new Error("Deployment must be claimed and have a creation request");
    const progressOptions: DeploymentProgressOptions = { expectedStatus: "PROVISIONING" };
    let details: DeploymentDetails = deployment.getDetails();
    try {
      const result: DeploymentProvisionResult = await this.provisioner.provisionDeployment({
        id: deployment.id, userId: deployment.userId, name: deployment.name, spec: deployment.spec, resourceId: deployment.resourceId ?? undefined,
        onBeforeImageUpdate: (baseline: DeploymentResourceBaseline): Promise<void> => this.verifyRedeployment(deployment, baseline),
      }, async (buildId: string, image: string): Promise<void> => {
        details = { ...details, buildId, image, updatedAt: new Date() };
        await this.repository.updateProgress(new Deployment(details), progressOptions);
      });
      await this.repository.updateProgress(new Deployment({ ...details, ...result, status: "RUNNING", error: null, updatedAt: new Date() }), progressOptions);
    } catch (error: unknown) {
      if (error instanceof DeploymentProgressConflictError) return;
      const message: string = error instanceof BuildProviderError || error instanceof BuildAccessDenied || error instanceof InvalidBuildInput
        ? error.message.slice(0, 1000) : "Deployment provisioning failed";
      try {
        await this.repository.updateProgress(new Deployment({ ...details, status: "FAILED", error: message, updatedAt: new Date() }), progressOptions);
      } catch (saveError: unknown) {
        if (!(saveError instanceof DeploymentProgressConflictError)) throw saveError;
      }
    }
  }

  private async verifyRedeployment(deployment: Deployment, baseline: DeploymentResourceBaseline): Promise<void> {
    if (!this.uow || !this.subscriptions) throw new BuildProviderError("Redeployment quota verification is unavailable");
    if (baseline.resourceId.toLowerCase() !== deployment.resourceId?.toLowerCase()) throw new BuildProviderError("Redeployment resource identity changed");
    const initial: User | null = await this.uow.run((repo: UnitOfWorkRepositories): Promise<User | null> => repo.users.findById(deployment.userId));
    if (!initial?.active || initial.suspended || !initial.stripeCustomerId) throw new DeploymentSubscriptionRequired("An active subscription is required");
    const products: readonly string[] = await this.subscriptions.getActiveSubscriptionProductIds(initial.stripeCustomerId);
    await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<void> => {
      const user: User | null = await repo.users.findByIdForUpdate(deployment.userId);
      if (!user?.active || user.suspended || user.stripeCustomerId !== initial.stripeCustomerId) throw new DeploymentSubscriptionRequired("User or billing association changed");
      const current: Deployment | null = repo.deployment.findByIdAndUserIdForUpdate
        ? await repo.deployment.findByIdAndUserIdForUpdate(deployment.id, deployment.userId)
        : await repo.deployment.findByIdAndUserId(deployment.id, deployment.userId);
      if (!current || current.status !== "PROVISIONING" || current.activeResourceUpdateId || current.resourceId !== deployment.resourceId) throw new DeploymentProgressConflictError();
      const plans: Plan[] = await repo.plans.findActiveByStripeProductIds(products);
      if (plans.length === 0) throw new DeploymentSubscriptionRequired("An active Kumo plan is required");
      const count: number = await repo.deployment.countReservedByUserId(deployment.userId);
      if (!plans.some((plan: Plan): boolean => count <= plan.deployments && baseline.configuration.maxVcpu <= plan.vcpu &&
        baseline.configuration.maxMemory <= plan.memory && baseline.configuration.maxScaling <= plan.maxReplicas)) throw new DeploymentQuotaExceeded("Applied deployment exceeds current plan limits");
    });
  }
}
