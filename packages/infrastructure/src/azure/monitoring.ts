import { ResilienceError } from "@nestjs/resilience";
import type { Metric, MetricValue, Response, TimeSeriesElement } from "@azure/arm-monitor";
import { DeploymentMetricsReadError, InvalidDeploymentResourceError, type DeploymentMetrics, type DeploymentMetricsReader, type MetricPoint, type MetricSeries } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { ownedContainerAppResource } from "./workload-scope.js";

const SERIES_LIMIT: number = 1000;

export interface MetricsClient {
  list(resourceId: string, options: {
    timespan: string; interval: string; metricnames: string; metricnamespace: string;
    aggregation: string; filter: string; top: number;
  }): Promise<Response>;
}

export interface MetricsReadInput {
  readonly resourceId: string;
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
  readonly start: Date;
  readonly end: Date;
}

@Injectable()
export class AzureMonitorMetricsReader implements DeploymentMetricsReader {
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;

  public constructor(config: ConfigService, private readonly client: MetricsClient) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
  }

  public async read(input: MetricsReadInput): Promise<DeploymentMetrics> {
    if (!ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup)) {
      throw new InvalidDeploymentResourceError("Deployment resource ID is outside the user's Kumo Container App");
    }
    const timespan: string = `${input.start.toISOString()}/${input.end.toISOString()}`;
    const fetchMetric: (name: string, filter: string) => Promise<Response> = (name: string, filter: string): Promise<Response> =>
      this.client.list(input.resourceId, {
        timespan, interval: "PT1M", metricnamespace: "Microsoft.App/containerapps",
        metricnames: name, aggregation: "Average", filter, top: SERIES_LIMIT,
      });
    let responses: [Response, Response, Response];
    try {
      responses = await Promise.all([
        fetchMetric("UsageNanoCores", "revisionName eq '*' and podName eq '*'"),
        fetchMetric("WorkingSetBytes", "revisionName eq '*' and podName eq '*'"),
        fetchMetric("Replicas", "revisionName eq '*'"),
      ]);
    } catch (error: unknown) {
      if (error instanceof ResilienceError) throw error;
      const status: unknown = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
      throw new DeploymentMetricsReadError(status === 403 ? "forbidden" : status === 429 ? "throttled" : "unavailable");
    }
    const [cpu, memory, replicas]: [Response, Response, Response] = responses;
    return {
      deploymentId: input.deploymentId, intervalSeconds: 60, aggregation: "Average",
      cpuUnit: "cores", memoryUnit: "MiB",
      cpu: this.normalize(cpu, "UsageNanoCores", 1_000_000_000, true),
      memory: this.normalize(memory, "WorkingSetBytes", 1_048_576, true),
      replicas: this.normalize(replicas, "Replicas", 1, false),
    };
  }

  private normalize(response: Response, name: string, divisor: number, requireReplica: boolean): MetricSeries[] {
    const metric: Metric | undefined = response.value.find((item: Metric): boolean => item.name.value === name);
    if (!metric) {
      if (response.value.length > 0) throw new DeploymentMetricsReadError("unavailable");
      return [];
    }
    if (metric.errorCode && metric.errorCode.toLowerCase() !== "success") throw new DeploymentMetricsReadError("unavailable");
    const expectedUnit: string = name === "UsageNanoCores" ? "NanoCores" : name === "WorkingSetBytes" ? "Bytes" : "Count";
    if (metric.unit.toLowerCase() !== expectedUnit.toLowerCase() || response.interval !== "PT1M") throw new DeploymentMetricsReadError("unavailable");
    if (metric.timeseries.length >= SERIES_LIMIT) throw new DeploymentMetricsReadError("unavailable");
    return metric.timeseries.map((series: TimeSeriesElement): MetricSeries => {
      const dimensions: Map<string, string> = new Map<string, string>(
        (series.metadatavalues ?? []).filter((entry): entry is typeof entry & { name: { value: string }; value: string } =>
          typeof entry.name?.value === "string" && typeof entry.value === "string")
          .map((entry): [string, string] => [entry.name.value.toLowerCase(), entry.value]),
      );
      const revisionName: string | null = dimensions.get("revisionname") ?? null;
      const replicaName: string | null = dimensions.get("podname") ?? null;
      if (!revisionName || (requireReplica && !replicaName)) throw new DeploymentMetricsReadError("unavailable");
      const points: MetricPoint[] = (series.data ?? []).map((point: MetricValue): MetricPoint => ({
        timestamp: point.timeStamp.toISOString(),
        value: typeof point.average === "number" && Number.isFinite(point.average) ? point.average / divisor : null,
      })).sort((left: MetricPoint, right: MetricPoint): number => left.timestamp.localeCompare(right.timestamp));
      return { revisionName, replicaName, points };
    });
  }
}
