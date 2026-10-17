import type { Deployment } from "@kumo/domain";
import type { GetDeploymentCase } from "./GetDeployment.case.js";
import type {
  DeploymentMetricsRange,
  DeploymentMetricsReader,
  DeploymentMetricsSnapshot,
} from "../../ports/deployment-metrics.js";

export class DeploymentMetricsUnavailableError extends Error {
  public constructor() {
    super("Metrics are available only for a running deployment with an Azure resource");
    this.name = "DeploymentMetricsUnavailableError";
  }
}

export class GetDeploymentMetricsCase {
  public constructor(
    private readonly getDeployment: Pick<GetDeploymentCase, "exec">,
    private readonly metricsReader: DeploymentMetricsReader,
  ) {}

  public async exec(
    deploymentId: string,
    userId: string,
    range: DeploymentMetricsRange,
  ): Promise<DeploymentMetricsSnapshot> {
    const deployment: Deployment = await this.getDeployment.exec(deploymentId, userId);
    const resourceId: string | null = deployment.resourceId;
    if (deployment.status !== "RUNNING" || !resourceId || !resourceId.trim()) {
      throw new DeploymentMetricsUnavailableError();
    }
    return this.metricsReader.read(resourceId, range);
  }
}
