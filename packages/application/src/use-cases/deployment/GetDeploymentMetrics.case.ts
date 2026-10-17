import type { Deployment } from "@kumo/domain";
import { DeploymentMetricsUnavailableError, InvalidMetricsRangeError, type DeploymentMetrics, type DeploymentMetricsReader, type MetricsRange } from "../../ports/monitoring.js";
import type { DeploymentRepository } from "../../ports/deployment.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";

export class GetDeploymentMetricsCase {
  public constructor(private readonly repository: DeploymentRepository, private readonly reader: DeploymentMetricsReader) {}

  public async exec(id: string, userId: string, range: MetricsRange, now: Date = new Date()): Promise<DeploymentMetrics> {
    const durations: Record<MetricsRange, number> = { "1h": 1, "6h": 6, "24h": 24 };
    if (!Object.hasOwn(durations, range)) throw new InvalidMetricsRangeError("Range must be 1h, 6h, or 24h");
    const deployment: Deployment | null = await this.repository.findByIdAndUserId(id, userId);
    if (!deployment) throw new DeploymentNotFoundError("Deployment was not found");
    if (deployment.status !== "RUNNING" || !deployment.resourceId) {
      throw new DeploymentMetricsUnavailableError("Deployment is not provisioned for monitoring");
    }
    const start: Date = new Date(now.getTime() - durations[range] * 60 * 60 * 1000);
    return this.reader.read({
      resourceId: deployment.resourceId, deploymentId: deployment.id, userId: deployment.userId,
      appName: deployment.name, start, end: now,
    });
  }
}
