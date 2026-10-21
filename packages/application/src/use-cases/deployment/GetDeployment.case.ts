import type { Deployment } from "@kumo/domain";
import { DeploymentNotFoundError, type DeploymentListFilters, type DeploymentRepository } from "../../ports/deployment.js";
import { DeploymentConfigurationReadError, type DeploymentConfigurationReader, type DeploymentReadResult } from "../../ports/deployment-configuration.js";

export class GetDeploymentCase {
  public constructor(private readonly repository: DeploymentRepository, private readonly configuration: DeploymentConfigurationReader) {}

  public async exec(id: string, userId: string): Promise<DeploymentReadResult> {
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(id, userId);
    if (!deployment) throw new DeploymentNotFoundError("Deployment was not found");
    return this.read(deployment);
  }

  public async list(userId: string, filters?: DeploymentListFilters): Promise<DeploymentReadResult[]> {
    // Applied regions may differ from the saved request, so filter after Azure reads.
    const deployments: Deployment[] = await this.repository.findByUserId(userId, filters ? { ...filters, region: undefined } : undefined);
    const results: DeploymentReadResult[] = [];
    // Bound ARM concurrency for large deployment lists.
    for (let offset: number = 0; offset < deployments.length; offset += 4) {
      results.push(...await Promise.all(deployments.slice(offset, offset + 4).map((deployment: Deployment): Promise<DeploymentReadResult> => this.read(deployment))));
    }
    return filters?.region ? results.filter((result: DeploymentReadResult): boolean =>
      (result.configuration?.region ?? result.deployment.spec?.region) === filters.region) : results;
  }

  private async read(deployment: Deployment): Promise<DeploymentReadResult> {
    if (deployment.status === "DELETED") return { deployment, configuration: null };
    if (!deployment.resourceId) {
      if (deployment.status === "RUNNING" || deployment.status === "STOPPED") throw new DeploymentConfigurationReadError("invalid");
      return { deployment, configuration: null };
    }
    return { deployment, configuration: await this.configuration.read({
      resourceId: deployment.resourceId, deploymentId: deployment.id, userId: deployment.userId, appName: deployment.name,
    }) };
  }
}
