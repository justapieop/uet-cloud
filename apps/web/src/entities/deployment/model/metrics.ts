import type { components, operations } from "@kumo/rest";

export type DeploymentMetrics = components["schemas"]["DeploymentMetricsResponseDto"];
export type MetricSeries = components["schemas"]["MetricSeriesDto"];
export type MetricsRange = NonNullable<NonNullable<operations["DeploymentMetricsController_get"]["parameters"]["query"]>["range"]>;

export const METRICS_RANGES: readonly MetricsRange[] = ["1h", "6h", "24h"];

export interface MetricSummary {
  readonly value: number | null;
  readonly timestamp: number | null;
  readonly sampledSeries: number;
}

export interface ChartPoint {
  readonly timestamp: number;
  readonly value: number | null;
}

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly points: readonly ChartPoint[];
}

export function metricBucket(timestamp: string, intervalSeconds: number): number | null {
  const parsed: number = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  const intervalMs: number = intervalSeconds * 1000;
  return Math.floor(parsed / intervalMs) * intervalMs;
}

export function chartSeries(series: readonly MetricSeries[], intervalSeconds: number, kind: "replica" | "revision"): ChartSeries[] {
  return series.map((item: MetricSeries, index: number): ChartSeries => {
    const pointsByBucket: Map<number, number | null> = new Map<number, number | null>();
    for (let pointIndex: number = 0; pointIndex < item.points.length; pointIndex += 1) {
      const point: MetricSeries["points"][number] = item.points[pointIndex];
      const bucket: number | null = metricBucket(point.timestamp, intervalSeconds);
      if (bucket !== null) pointsByBucket.set(bucket, point.value);
    }
    const points: ChartPoint[] = [...pointsByBucket.entries()]
      .sort(([left]: [number, number | null], [right]: [number, number | null]): number => left - right)
      .map(([timestamp, value]: [number, number | null]): ChartPoint => ({ timestamp, value }));
    const label: string = kind === "replica" ? `Replica ${index + 1}` : "Active revision";
    return { key: `${kind}:${index}`, label, points };
  });
}

export function activeRevisionAverageSeries(series: readonly MetricSeries[], intervalSeconds: number): ChartSeries[] {
  if (series.length === 0) return [];
  const buckets: Map<number, { sum: number; count: number }> = new Map<number, { sum: number; count: number }>();
  for (let seriesIndex: number = 0; seriesIndex < series.length; seriesIndex += 1) {
    const item: MetricSeries = series[seriesIndex]!;
    for (let pointIndex: number = 0; pointIndex < item.points.length; pointIndex += 1) {
      const point: MetricSeries["points"][number] = item.points[pointIndex]!;
      const bucket: number | null = metricBucket(point.timestamp, intervalSeconds);
      if (bucket === null) continue;
      const current: { sum: number; count: number } = buckets.get(bucket) ?? { sum: 0, count: 0 };
      if (point.value !== null && Number.isFinite(point.value)) {
        current.sum += point.value;
        current.count += 1;
      }
      buckets.set(bucket, current);
    }
  }
  const points: ChartPoint[] = [...buckets.entries()]
    .sort(([left]: [number, { sum: number; count: number }], [right]: [number, { sum: number; count: number }]): number => left - right)
    .map(([timestamp, value]: [number, { sum: number; count: number }]): ChartPoint => ({
      timestamp,
      value: value.count > 0 ? value.sum / value.count : null,
    }));
  return [{ key: "active-revision-average", label: "Active revision average", points }];
}

export function latestMetricSummary(series: readonly MetricSeries[], intervalSeconds: number, mode: "average" | "sum"): MetricSummary {
  const byBucket: Map<number, Map<number, number>> = new Map<number, Map<number, number>>();
  series.forEach((item: MetricSeries, index: number): void => {
    for (let pointIndex: number = 0; pointIndex < item.points.length; pointIndex += 1) {
      const point: MetricSeries["points"][number] = item.points[pointIndex];
      const bucket: number | null = metricBucket(point.timestamp, intervalSeconds);
      if (bucket === null) continue;
      const values: Map<number, number> = byBucket.get(bucket) ?? new Map<number, number>();
      if (point.value !== null && Number.isFinite(point.value)) values.set(index, point.value);
      else values.delete(index);
      byBucket.set(bucket, values);
    }
  });
  const buckets: number[] = [...byBucket.keys()].sort((left: number, right: number): number => right - left);
  for (let bucketIndex: number = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const timestamp: number = buckets[bucketIndex];
    const values: number[] = [...(byBucket.get(timestamp)?.values() ?? [])];
    if (values.length === 0) continue;
    const total: number = values.reduce((sum: number, value: number): number => sum + value, 0);
    return { value: mode === "average" ? total / values.length : total, timestamp, sampledSeries: values.length };
  }
  return { value: null, timestamp: null, sampledSeries: 0 };
}
