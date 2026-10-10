import { Deployment, type DeploymentDetails, type DeploymentSpec } from "@kumo/domain";
import type { AzureDeployPort, UpdateAppParams } from "../../ports/azure-deploy.js";
import type { DeploymentRepository } from "../../ports/deployment.js";

export interface UpdateDeploymentInput {
  readonly id: string;
  readonly userId: string;
  readonly name?: string;
  readonly spec: Partial<DeploymentSpec>;
}

export class UpdateDeploymentCase {
  public constructor(
    private readonly deployService: AzureDeployPort,
    private readonly deploymentRepository?: DeploymentRepository,
  ) {}

  public async exec(input: UpdateDeploymentInput): Promise<Deployment> {
    const existingDeployment: Deployment | null = this.deploymentRepository
      ? await this.deploymentRepository.findById(input.id)
      : null;

    const appName: string = input.name ?? existingDeployment?.name ?? input.id;
    const resourceGroupName: string = await this.deployService.ensureUserResourceGroup(input.userId);

    const updateParams: UpdateAppParams = {
      resourceGroupName,
      appName,
      spec: input.spec,
    };

    try {
      const result: { fqdn: string } = await this.deployService.updateContainerApp(updateParams);

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

      if (this.deploymentRepository) {
        await this.deploymentRepository.update(updatedDeployment);
      }

      return updatedDeployment;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);

      if (existingDeployment && this.deploymentRepository) {
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
        await this.deploymentRepository.update(new Deployment(failedDetails));
      }

      throw error;
    }
  }
}
