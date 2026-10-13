import { randomUUID } from "node:crypto";
import { Deployment, type DeploymentDetails, type DeploymentSpec } from "@kumo/domain";
import type { DeployAppParams } from "../../ports/azure-deploy.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface CreateDeploymentInput {
  readonly id?: string;
  readonly userId: string;
  readonly name: string;
  readonly spec: DeploymentSpec;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: CreateDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.createDeployment(repo, input));
  }

  public async createDeployment(repo: UnitOfWorkRepositories, input: CreateDeploymentInput): Promise<Deployment> {
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

    if (repo.deployment) {
      await repo.deployment.save(pendingDeployment);
    }

    try {
      const resourceGroupName: string = await repo.azure.ensureUserResourceGroup(input.userId);

      const deployParams: DeployAppParams = {
        resourceGroupName,
        appName: input.name,
        spec: pendingDeployment.spec,
      };

      const result: { fqdn: string } = await repo.azure.deployContainerApp(deployParams);

      const runningDetails: DeploymentDetails = {
        ...initialDetails,
        status: "RUNNING",
        fqdn: result.fqdn,
        updatedAt: new Date(),
      };
      const runningDeployment: Deployment = new Deployment(runningDetails);

      if (repo.deployment) {
        await repo.deployment.update(runningDeployment);
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

      if (repo.deployment) {
        await repo.deployment.update(failedDeployment);
      }

      throw error;
    }
  }
}
