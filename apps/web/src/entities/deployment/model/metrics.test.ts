import assert from "node:assert/strict";
import test from "node:test";
import type { DeploymentMetrics, MetricSeries } from "./metrics.ts";
import { METRICS_RANGES, chartSeries, latestMetricSummary } from "./metrics.ts";
import { createLatestMetricsRequest, getDeploymentMetrics, metricsErrorMessage, MetricsRequestError } from "../api/get-deployment-metrics.ts";

function series(revision: string, replica: string | null, points: readonly [string, number | null][]): MetricSeries {
  return { revision_name: revision, replica_name: replica, points: points.map(([timestamp, value]: [string, number | null]): { timestamp: string; value: number | null } => ({ timestamp, value })) };
}

test("CPU and memory use latest aligned per-replica averages in backend units", (): void => {
  const cpu: MetricSeries[] = [
    series("rev-a", "pod-1", [["2026-10-29T10:00:00Z", 1], ["2026-10-29T10:01:00Z", 2]]),
    series("rev-b", "pod-2", [["2026-10-29T10:01:00Z", 4]]),
  ];
  const memory: MetricSeries[] = [
    series("rev-a", "pod-1", [["2026-10-29T10:01:00Z", 128]]),
    series("rev-b", "pod-2", [["2026-10-29T10:01:00Z", 256]]),
  ];
  assert.equal(latestMetricSummary(cpu, 60, "average").value, 3);
  assert.equal(latestMetricSummary(memory, 60, "average").value, 192);
  assert.equal(latestMetricSummary(cpu, 60, "average").sampledSeries, 2);
});

test("revision counts add only within the same minute and preserve fractional averages", (): void => {
  const revisions: MetricSeries[] = [
    series("rev-a", null, [["2026-10-29T10:00:00Z", 3], ["2026-10-29T10:01:02Z", 1.5]]),
    series("rev-b", null, [["2026-10-29T10:01:50Z", 2]]),
  ];
  assert.equal(latestMetricSummary(revisions, 60, "sum").value, 3.5);
  assert.equal(latestMetricSummary(revisions, 60, "sum").sampledSeries, 2);
  assert.equal(latestMetricSummary([
    series("rev-a", null, [["2026-10-29T10:00:00Z", 3]]),
    series("rev-b", null, [["2026-10-29T10:01:00Z", 2]]),
  ], 60, "sum").value, 2);
});

test("null is missing, zero is valid, and empty series have no current value", (): void => {
  const input: MetricSeries[] = [
    series("rev-a", "pod-1", [["2026-10-29T10:00:00Z", 2], ["2026-10-29T10:01:00Z", null]]),
    series("rev-a", "pod-2", [["2026-10-29T10:01:00Z", 0]]),
  ];
  assert.equal(latestMetricSummary(input, 60, "average").value, 0);
  assert.equal(latestMetricSummary(input, 60, "average").sampledSeries, 1);
  assert.equal(latestMetricSummary([], 60, "average").value, null);
  assert.equal(latestMetricSummary([series("rev-a", "pod-1", [["2026-10-29T10:00:00Z", null]])], 60, "sum").value, null);
  assert.deepEqual(chartSeries(input, 60, "replica")[0].points.map((point): number | null => point.value), [2, null]);
});

test("chart data keeps separate, sorted replica and revision series", (): void => {
  const input: MetricSeries[] = [series("rev-a", "pod-1", [["2026-10-29T10:02:00Z", 4], ["2026-10-29T10:00:00Z", 1]])];
  assert.equal(chartSeries(input, 60, "replica")[0].label, "rev-a / pod-1");
  assert.deepEqual(chartSeries(input, 60, "replica")[0].points.map((point): number | null => point.value), [1, 4]);
  assert.equal(chartSeries(input, 60, "revision")[0].label, "rev-a");
});

test("all supported ranges are sent to the same-origin endpoint", async (): Promise<void> => {
  const originalFetch: typeof fetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    return Response.json({ deployment_id: "id", interval_seconds: 60, aggregation: "Average", cpu_unit: "cores", memory_unit: "MiB", cpu: [], memory: [], replicas: [] });
  };
  try {
    await Promise.all(METRICS_RANGES.map((range): Promise<DeploymentMetrics> => getDeploymentMetrics("test-id", range, new AbortController().signal)));
    assert.deepEqual(urls, ["/api/deployments/test-id/metrics?range=1h", "/api/deployments/test-id/metrics?range=6h", "/api/deployments/test-id/metrics?range=24h"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP errors produce safe messages and remain retryable", async (): Promise<void> => {
  const originalFetch: typeof fetch = globalThis.fetch;
  let attempts: number = 0;
  globalThis.fetch = async (): Promise<Response> => {
    attempts += 1;
    return attempts === 1 ? new Response(null, { status: 503 }) : Response.json({ cpu: [], memory: [], replicas: [] });
  };
  try {
    await assert.rejects(getDeploymentMetrics("test-id", "1h", new AbortController().signal), (error: unknown): boolean => error instanceof MetricsRequestError && error.status === 503);
    await getDeploymentMetrics("test-id", "1h", new AbortController().signal);
    assert.equal(attempts, 2);
    [401, 403, 404, 409, 502, 503, null].forEach((status: number | null): void => { assert.ok(metricsErrorMessage(status).length > 0); });
  } finally { globalThis.fetch = originalFetch; }
});

test("rapid range changes abort old work and ignore a late stale response", async (): Promise<void> => {
  const firstData: DeploymentMetrics = { deployment_id: "first", interval_seconds: 60, aggregation: "Average", cpu_unit: "cores", memory_unit: "MiB", cpu: [], memory: [], replicas: [] };
  const secondData: DeploymentMetrics = { ...firstData, deployment_id: "second" };
  let resolveFirst: (value: DeploymentMetrics) => void = (): void => {};
  let resolveSecond: (value: DeploymentMetrics) => void = (): void => {};
  const signals: AbortSignal[] = [];
  const requests: ReturnType<typeof createLatestMetricsRequest> = createLatestMetricsRequest((_id, range, signal): Promise<DeploymentMetrics> => {
    signals.push(signal);
    return new Promise<DeploymentMetrics>((resolve: (value: DeploymentMetrics) => void): void => {
      if (range === "1h") resolveFirst = resolve;
      else resolveSecond = resolve;
    });
  });
  const oldResult: Promise<DeploymentMetrics | null> = requests.load("id", "1h");
  const newResult: Promise<DeploymentMetrics | null> = requests.load("id", "6h");
  assert.equal(signals[0].aborted, true);
  resolveSecond(secondData);
  resolveFirst(firstData);
  assert.equal((await newResult)?.deployment_id, "second");
  assert.equal(await oldResult, null);
  requests.cancel();
});
