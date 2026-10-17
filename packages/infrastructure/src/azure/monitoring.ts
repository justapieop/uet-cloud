import {
  MonitorClient,
  type MetricsListOptionalParams,
} from "@azure/arm-monitor";
import { DefaultAzureCredential } from "@azure/identity";
import {
  DeploymentMetricsReaderError,
  type DeploymentMetricPoint,
  type DeploymentMetricsRange,
  type DeploymentMetricsReader,
  type DeploymentMetricsSnapshot,
} from "@kumo/application";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

const METRICS_NAMESPACE: string = "Microsoft.App/containerapps";
const METRICS_INTERVAL: string = "PT1M";
const NANOS_PER_CORE: number = 1_000_000_000;
const BYTES_PER_MEBIBYTE: number = 1_048_576;
const METRICS_CACHE_TTL_MILLISECONDS: number = 60_000;
const MAX_METRICS_CACHE_ENTRIES: number = 1_000;
const RANGE_MILLISECONDS: Readonly<Record<DeploymentMetricsRange, number>> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

export type AzureMonitorMetricsClient = Pick<MonitorClient["metrics"], "list">;
export type AzureMonitorMetricsResponse = Awaited<ReturnType<AzureMonitorMetricsClient["list"]>>;
type AzureMonitorMetric = AzureMonitorMetricsResponse["value"][number];
type AzureMonitorTimeSeries = AzureMonitorMetric["timeseries"][number];
type AzureMonitorMetricValue = NonNullable<AzureMonitorTimeSeries["data"]>[number];
type AzureAggregation = "average" | "maximum";
type MetricPointField = "cpuCores" | "memoryMiB" | "replicas";

interface MutableDeploymentMetricPoint {
  timestamp: string;
  cpuCores: number | null;
  memoryMiB: number | null;
  replicas: number | null;
}

interface CachedDeploymentMetrics {
  readonly expiresAt: number;
  readonly snapshot: DeploymentMetricsSnapshot;
}

@Injectable()
export class AzureMonitorMetricsReader implements DeploymentMetricsReader {
  private readonly config: ConfigService;
  private client: AzureMonitorMetricsClient | undefined;
  private readonly cache: Map<string, CachedDeploymentMetrics> = new Map<string, CachedDeploymentMetrics>();
  private readonly inFlight: Map<string, Promise<DeploymentMetricsSnapshot>> = new Map<string, Promise<DeploymentMetricsSnapshot>>();

  public constructor(
    config: ConfigService,
    client?: AzureMonitorMetricsClient,
    private readonly now: () => Date = (): Date => new Date(),
  ) {
    this.config = config;
    this.client = client;
  }

  public async read(resourceId: string, range: DeploymentMetricsRange): Promise<DeploymentMetricsSnapshot> {
    const subscriptionId: string = this.getSubscriptionId();
    this.validateResourceId(resourceId, subscriptionId);

    const endTime: Date = this.now();
    const nowMilliseconds: number = endTime.getTime();
    const cacheKey: string = resourceId.toLowerCase() + "|" + range;
    const cached: CachedDeploymentMetrics | undefined = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > nowMilliseconds) return cached.snapshot;
    if (cached) this.cache.delete(cacheKey);

    const existingRequest: Promise<DeploymentMetricsSnapshot> | undefined = this.inFlight.get(cacheKey);
    if (existingRequest) return existingRequest;

    const client: AzureMonitorMetricsClient = this.getClient(subscriptionId);
    const request: Promise<DeploymentMetricsSnapshot> = this.query(client, resourceId, range, endTime);
    this.inFlight.set(cacheKey, request);
    try {
      const snapshot: DeploymentMetricsSnapshot = await request;
      this.cacheSnapshot(cacheKey, snapshot, nowMilliseconds);
      return snapshot;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async query(
    client: AzureMonitorMetricsClient,
    resourceId: string,
    range: DeploymentMetricsRange,
    endTime: Date,
  ): Promise<DeploymentMetricsSnapshot> {
    const startTime: Date = new Date(endTime.getTime() - RANGE_MILLISECONDS[range]);
    const options: MetricsListOptionalParams = {
      timespan: startTime.toISOString() + "/" + endTime.toISOString(),
      interval: METRICS_INTERVAL,
      metricnames: "UsageNanoCores,WorkingSetBytes,Replicas",
      aggregation: "Average,Maximum",
      metricnamespace: METRICS_NAMESPACE,
    };

    let response: AzureMonitorMetricsResponse;
    try {
      response = await client.list(resourceId, options);
    } catch (error: unknown) {
      throw this.toReaderError(error);
    }

    return normalizeAzureMonitorResponse(response);
  }

  private cacheSnapshot(key: string, snapshot: DeploymentMetricsSnapshot, nowMilliseconds: number): void {
    this.cache.forEach((entry: CachedDeploymentMetrics, cacheKey: string): void => {
      if (entry.expiresAt <= nowMilliseconds) this.cache.delete(cacheKey);
    });
    if (this.cache.size >= MAX_METRICS_CACHE_ENTRIES) {
      const firstKey: string | undefined = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { expiresAt: nowMilliseconds + METRICS_CACHE_TTL_MILLISECONDS, snapshot });
  }

  private getSubscriptionId(): string {
    const subscriptionId: string | undefined = this.config.get<string>("AZURE_SUBSCRIPTION_ID");
    if (!subscriptionId || !subscriptionId.trim()) {
      throw new DeploymentMetricsReaderError("configuration_missing");
    }
    return subscriptionId.trim();
  }

  private getClient(subscriptionId: string): AzureMonitorMetricsClient {
    if (!this.client) {
      const credential: DefaultAzureCredential = new DefaultAzureCredential();
      const monitorClient: MonitorClient = new MonitorClient(credential, subscriptionId);
      this.client = monitorClient.metrics;
    }
    return this.client;
  }

  private validateResourceId(resourceId: string, subscriptionId: string): void {
    const match: RegExpExecArray | null = /^\/subscriptions\/([^/]+)\/resourceGroups\/[^/]+\/providers\/Microsoft\.App\/containerApps\/[^/]+$/i.exec(resourceId);
    if (!match || match[1]?.toLowerCase() !== subscriptionId.toLowerCase()) {
      throw new DeploymentMetricsReaderError("resource_not_found");
    }
  }

  private toReaderError(error: unknown): DeploymentMetricsReaderError {
    const statusCode: number | undefined = this.getStatusCode(error);
    if (statusCode === 401 || statusCode === 403) {
      return new DeploymentMetricsReaderError("access_denied");
    }
    if (statusCode === 404) {
      return new DeploymentMetricsReaderError("resource_not_found");
    }
    if (statusCode === 429) {
      return new DeploymentMetricsReaderError("rate_limited");
    }
    return new DeploymentMetricsReaderError("unavailable");
  }

  private getStatusCode(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
    return typeof error.statusCode === "number" ? error.statusCode : undefined;
  }
}

export function normalizeAzureMonitorResponse(response: AzureMonitorMetricsResponse): DeploymentMetricsSnapshot {
  const points: Map<string, MutableDeploymentMetricPoint> = new Map<string, MutableDeploymentMetricPoint>();
  const metrics: readonly AzureMonitorMetric[] = response.value;
  const cpuMetric: AzureMonitorMetric | undefined = metrics.find((metric: AzureMonitorMetric): boolean => metric.name.value === "UsageNanoCores");
  const memoryMetric: AzureMonitorMetric | undefined = metrics.find((metric: AzureMonitorMetric): boolean => metric.name.value === "WorkingSetBytes");
  const replicaMetric: AzureMonitorMetric | undefined = metrics.find((metric: AzureMonitorMetric): boolean => metric.name.value === "Replicas");

  accumulateMetric(cpuMetric, "average", "cpuCores", NANOS_PER_CORE, points);
  accumulateMetric(memoryMetric, "average", "memoryMiB", BYTES_PER_MEBIBYTE, points);
  accumulateMetric(replicaMetric, "maximum", "replicas", 1, points);

  const normalizedPoints: DeploymentMetricPoint[] = Array.from(points.values())
    .sort((left: MutableDeploymentMetricPoint, right: MutableDeploymentMetricPoint): number => left.timestamp.localeCompare(right.timestamp));

  return {
    intervalSeconds: 60,
    cpuUnit: "cores",
    memoryUnit: "MiB",
    replicaUnit: "count",
    aggregation: {
      cpu: "average-per-pod-series-summed-across-pods-and-revisions",
      memory: "average-per-pod-series-summed-across-pods-and-revisions",
      replicas: "maximum-per-revision-summed-across-revisions",
    },
    points: normalizedPoints,
  };
}

function accumulateMetric(
  metric: AzureMonitorMetric | undefined,
  aggregation: AzureAggregation,
  field: MetricPointField,
  divisor: number,
  points: Map<string, MutableDeploymentMetricPoint>,
): void {
  const timeSeries: readonly AzureMonitorTimeSeries[] = metric?.timeseries ?? [];
  for (let seriesIndex: number = 0; seriesIndex < timeSeries.length; seriesIndex += 1) {
    const series: AzureMonitorTimeSeries = timeSeries[seriesIndex]!;
    const dataPoints: readonly AzureMonitorMetricValue[] = series.data ?? [];
    for (let pointIndex: number = 0; pointIndex < dataPoints.length; pointIndex += 1) {
      const dataPoint: AzureMonitorMetricValue = dataPoints[pointIndex]!;
      const value: number | undefined = dataPoint[aggregation];
      const timestamp: Date = dataPoint.timeStamp;
      if (typeof value !== "number" || !Number.isFinite(value) || Number.isNaN(timestamp.getTime())) continue;

      const timestampKey: string = timestamp.toISOString();
      let point: MutableDeploymentMetricPoint | undefined = points.get(timestampKey);
      if (!point) {
        point = { timestamp: timestampKey, cpuCores: null, memoryMiB: null, replicas: null };
        points.set(timestampKey, point);
      }
      const convertedValue: number = value / divisor;
      const previousValue: number | null = point[field];
      point[field] = previousValue === null ? convertedValue : previousValue + convertedValue;
    }
  }
}
