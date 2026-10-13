import { Deployment, type DeploymentDetails, type DeploymentSpec } from "@kumo/domain";
import type { UpdateAppParams } from "../../ports/azure-deploy.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/index.js";

export interface UpdateDeploymentInput {
  readonly id: string;
  readonly userId: string;
  readonly name?: string;
  readonly spec: Partial<DeploymentSpec>;
}

export class UpdateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork
  ) { }

  public exec(input: UpdateDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.updateDeployment(repo, input));
  }

  private async updateDeployment(repo: UnitOfWorkRepositories, input: UpdateDeploymentInput): Promise<Deployment> {
    const existingDeployment: Deployment | null = repo.deployment
      ? await repo.deployment.findById(input.id)
      : null;

    const appName: string = input.name ?? existingDeployment?.name ?? input.id;
    const resourceGroupName: string = await repo.azure.ensureUserResourceGroup(input.userId);

    const updateParams: UpdateAppParams = {
      resourceGroupName,
      appName,
      spec: input.spec,
    };

    try {
      const result: { fqdn: string } = await repo.azure.updateContainerApp(updateParams);

      const mergedSpec: DeploymentSpec = {
        image: input.spec.image ?? existingDeployment?.spec.image ?? "unknown",
        targetPort: input.spec.targetPort ?? existingDeployment?.spec.targetPort ?? 80,
        resources: {
          cpu: input.spec.resources?.cpu ?? existingDeployment?.spec.resources?.cpu ?? 0.25,
          memory: input.spec.resources?.memory ?? existingDeployment?.spec.resources?.memory ?? 0.5,
        },
        scaling: {
          minReplicas: input.spec.scaling?.minReplicas ?? existingDeployment?.spec.scaling?.minReplicas ?? 0,
          maxReplicas: input.spec.scaling?.maxReplicas ?? existingDeployment?.spec.scaling?.maxReplicas ?? 2,
        },
        envVars: input.spec.envVars !== undefined ? input.spec.envVars : (existingDeployment?.spec.envVars ?? null),
      };

      const updatedDetails: DeploymentDetails = {
        id: input.id,
        userId: input.userId,
        name: appName,
        status: "RUNNING",
        spec: mergedSpec,
        fqdn: result.fqdn || existingDeployment?.fqdn || null,
        errorMessage: null,
        createdAt: existingDeployment?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };

      const updatedDeployment: Deployment = new Deployment(updatedDetails);

      if (repo.deployment) {
        await repo.deployment.update(updatedDeployment);
      }

      return updatedDeployment;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);

      if (existingDeployment && repo.deployment) {
        const failedDetails: DeploymentDetails = {
          id: existingDeployment.id,
          userId: existingDeployment.userId,
          name: existingDeployment.name,
          status: "FAILED",
          spec: existingDeployment.spec,
          fqdn: existingDeployment.fqdn,
          errorMessage,
          createdAt: existingDeployment.createdAt,
          updatedAt: new Date(),
        };
        await repo.deployment.update(new Deployment(failedDetails));
      }

      throw error;
    }
  }
}
