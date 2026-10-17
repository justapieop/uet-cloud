export type DeploymentMetricsRange = "1h" | "6h" | "24h";

export type DeploymentMetricsReaderErrorKind =
  | "configuration_missing"
  | "access_denied"
  | "resource_not_found"
  | "rate_limited"
  | "unavailable";

export interface DeploymentMetricPoint {
  readonly timestamp: string;
  readonly cpuCores: number | null;
  readonly memoryMiB: number | null;
  readonly replicas: number | null;
}

export interface DeploymentMetricAggregation {
  readonly cpu: "average-per-pod-series-summed-across-pods-and-revisions";
  readonly memory: "average-per-pod-series-summed-across-pods-and-revisions";
  readonly replicas: "maximum-per-revision-summed-across-revisions";
}

export interface DeploymentMetricsSnapshot {
  readonly intervalSeconds: number;
  readonly cpuUnit: "cores";
  readonly memoryUnit: "MiB";
  readonly replicaUnit: "count";
  readonly aggregation: DeploymentMetricAggregation;
  readonly points: readonly DeploymentMetricPoint[];
}

export interface DeploymentMetricsReader {
  read(resourceId: string, range: DeploymentMetricsRange): Promise<DeploymentMetricsSnapshot>;
}

export class DeploymentMetricsReaderError extends Error {
  public constructor(public readonly kind: DeploymentMetricsReaderErrorKind) {
    super("The monitoring provider could not return deployment metrics");
    this.name = "DeploymentMetricsReaderError";
  }
}
