export type MetricsRange = "1h" | "6h" | "24h";

export interface MetricPoint {
  readonly timestamp: string;
  readonly value: number | null;
}

export interface MetricSeries {
  readonly revisionName: string | null;
  readonly replicaName: string | null;
  readonly points: readonly MetricPoint[];
}

export interface DeploymentMetrics {
  readonly deploymentId: string;
  readonly intervalSeconds: 60;
  readonly aggregation: "Average";
  readonly cpuUnit: "cores";
  readonly memoryUnit: "MiB";
  readonly cpu: readonly MetricSeries[];
  readonly memory: readonly MetricSeries[];
  readonly replicas: readonly MetricSeries[];
}

export interface DeploymentMetricsReader {
  read(input: {
    readonly resourceId: string;
    readonly deploymentId: string;
    readonly userId: string;
    readonly appName: string;
    readonly start: Date;
    readonly end: Date;
  }): Promise<DeploymentMetrics>;
}

export class DeploymentMetricsUnavailableError extends Error {}
export class InvalidDeploymentResourceError extends Error {}
export class InvalidMetricsRangeError extends Error {}

export class DeploymentMetricsReadError extends Error {
  public constructor(public readonly reason: "forbidden" | "throttled" | "unavailable") {
    super("Deployment metrics could not be read");
  }
}
