import { randomUUID } from "node:crypto";
import { Deployment, type DeploymentDetails, type DeploymentSpec } from "@kumo/domain";
import type { AzureDeployPort, DeployAppParams } from "../../ports/azure-deploy.js";
import type { DeploymentRepository } from "../../ports/deployment.js";

export interface CreateDeploymentInput {
  readonly id?: string;
  readonly userId: string;
  readonly name: string;
  readonly spec: DeploymentSpec;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly deployService: AzureDeployPort,
    private readonly deploymentRepository?: DeploymentRepository,
  ) {}

  public async exec(input: CreateDeploymentInput): Promise<Deployment> {
    const deploymentId: string = input.id ?? randomUUID();
    const initialDetails: DeploymentDetails = {
      id: deploymentId,
      userId: input.userId,
      name: input.name,
      status: "PENDING",
      spec: input.spec,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const pendingDeployment: Deployment = new Deployment(initialDetails);

    if (this.deploymentRepository) {
      await this.deploymentRepository.save(pendingDeployment);
    }

    try {
      const resourceGroupName: string = await this.deployService.ensureUserResourceGroup(input.userId);

      const deployParams: DeployAppParams = {
        resourceGroupName,
        appName: input.name,
        spec: pendingDeployment.spec,
      };

      const result: { fqdn: string } = await this.deployService.deployContainerApp(deployParams);

      const runningDetails: DeploymentDetails = {
        ...initialDetails,
        status: "RUNNING",
        fqdn: result.fqdn,
        updatedAt: new Date(),
      };
      const runningDeployment: Deployment = new Deployment(runningDetails);

      if (this.deploymentRepository) {
        await this.deploymentRepository.update(runningDeployment);
      }

      return runningDeployment;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const failedDetails: DeploymentDetails = {
        ...initialDetails,
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      };
      const failedDeployment: Deployment = new Deployment(failedDetails);

      if (this.deploymentRepository) {
        await this.deploymentRepository.update(failedDeployment);
      }

      throw error;
    }
  }
}
