import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricsListOptionalParams } from "@azure/arm-monitor";
import { ConfigService } from "@nestjs/config";
import { DeploymentMetricsReaderError } from "@kumo/application";
import type { DeploymentMetricsSnapshot } from "@kumo/application";
import {
  AzureMonitorMetricsReader,
  normalizeAzureMonitorResponse,
  type AzureMonitorMetricsClient,
  type AzureMonitorMetricsResponse,
} from "../dist/azure/monitoring.js";

interface MetricFixture {
  id: string;
  type: string;
  name: { value: string; localizedValue?: string };
  unit: string;
  timeseries: {
    metadatavalues?: { name: { value: string }; value: string }[];
    data: { timeStamp: Date; average?: number; maximum?: number }[];
  }[];
}

interface MetricsCall {
  resourceId: string;
  options: MetricsListOptionalParams | undefined;
}

function metric(name: string, timeSeries: MetricFixture["timeseries"], unit: string): MetricFixture {
  return { id: "/metrics/" + name, type: "Microsoft.Insights/metrics", name: { value: name }, unit, timeseries: timeSeries };
}

function response(metrics: readonly MetricFixture[]): AzureMonitorMetricsResponse {
  return { value: metrics } as unknown as AzureMonitorMetricsResponse;
}

function readerWithResponse(
  payload: AzureMonitorMetricsResponse,
  calls: MetricsCall[],
): AzureMonitorMetricsReader {
  const client: AzureMonitorMetricsClient = {
    list: async (resourceId: string, options?: MetricsListOptionalParams): Promise<AzureMonitorMetricsResponse> => {
      calls.push({ resourceId, options });
      return payload;
    },
  };
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub" });
  const fixedNow: Date = new Date("2026-10-17T05:00:00.000Z");
  return new AzureMonitorMetricsReader(config, client, (): Date => fixedNow);
}

const RESOURCE_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/sample-app";

test("queries supported ACA metrics once with the namespace, one-minute grain, and requested time range", async (): Promise<void> => {
  const calls: MetricsCall[] = [];
  const reader: AzureMonitorMetricsReader = readerWithResponse(response([]), calls);

  await Promise.all([reader.read(RESOURCE_ID, "1h"), reader.read(RESOURCE_ID, "1h")]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.resourceId, RESOURCE_ID);
  assert.deepEqual(calls[0]?.options, {
    timespan: "2026-10-17T04:00:00.000Z/2026-10-17T05:00:00.000Z",
    interval: "PT1M",
    metricnames: "UsageNanoCores,WorkingSetBytes,Replicas",
    aggregation: "Average,Maximum",
    metricnamespace: "Microsoft.App/containerapps",
  });
});

test("deduplicates concurrent requests and caches successful resource/range reads for one metric interval", async (): Promise<void> => {
  const calls: MetricsCall[] = [];
  const payload: AzureMonitorMetricsResponse = response([]);
  const client: AzureMonitorMetricsClient = {
    list: async (resourceId: string, options?: MetricsListOptionalParams): Promise<AzureMonitorMetricsResponse> => {
      calls.push({ resourceId, options });
      return payload;
    },
  };
  const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub" });
  let currentTime: Date = new Date("2026-10-17T05:00:00.000Z");
  const reader: AzureMonitorMetricsReader = new AzureMonitorMetricsReader(config, client, (): Date => currentTime);

  await Promise.all([reader.read(RESOURCE_ID, "1h"), reader.read(RESOURCE_ID, "1h")]);
  await reader.read(RESOURCE_ID, "1h");
  assert.equal(calls.length, 1);

  currentTime = new Date(currentTime.getTime() + 60_000);
  await reader.read(RESOURCE_ID, "1h");
  assert.equal(calls.length, 2);
});

test("normalizes multiple pod and revision series, UTC timestamps, units, and scale-to-zero", (): void => {
  const firstTimestamp: Date = new Date("2026-10-17T04:01:00-04:00");
  const secondTimestamp: Date = new Date("2026-10-17T08:02:00.000Z");
  const payload: AzureMonitorMetricsResponse = response([
    metric("UsageNanoCores", [
      { metadatavalues: [{ name: { value: "podName" }, value: "pod-a" }], data: [{ timeStamp: firstTimestamp, average: 100_000_000 }, { timeStamp: secondTimestamp, average: 0 }] },
      { metadatavalues: [{ name: { value: "podName" }, value: "pod-b" }], data: [{ timeStamp: firstTimestamp, average: 250_000_000 }] },
    ], "NanoCores"),
    metric("WorkingSetBytes", [
      { metadatavalues: [{ name: { value: "podName" }, value: "pod-a" }], data: [{ timeStamp: firstTimestamp, average: 10 * 1_048_576 }] },
      { metadatavalues: [{ name: { value: "podName" }, value: "pod-b" }], data: [{ timeStamp: firstTimestamp, average: 20.5 * 1_048_576 }] },
    ], "Bytes"),
    metric("Replicas", [
      { metadatavalues: [{ name: { value: "revisionName" }, value: "rev-a" }], data: [{ timeStamp: firstTimestamp, maximum: 2 }, { timeStamp: secondTimestamp, maximum: 0 }] },
      { metadatavalues: [{ name: { value: "revisionName" }, value: "rev-b" }], data: [{ timeStamp: firstTimestamp, maximum: 1 }] },
    ], "Count"),
  ]);

  const result: DeploymentMetricsSnapshot = normalizeAzureMonitorResponse(payload);

  assert.equal(result.intervalSeconds, 60);
  assert.equal(result.cpuUnit, "cores");
  assert.equal(result.memoryUnit, "MiB");
  assert.equal(result.aggregation.replicas, "maximum-per-revision-summed-across-revisions");
  assert.deepEqual(result.points, [
    { timestamp: "2026-10-17T08:01:00.000Z", cpuCores: 0.35, memoryMiB: 30.5, replicas: 3 },
    { timestamp: "2026-10-17T08:02:00.000Z", cpuCores: 0, memoryMiB: null, replicas: 0 },
  ]);
});

test("returns no points when Azure has no metric data and leaves absent metrics null", (): void => {
  const empty: AzureMonitorMetricsResponse = response([]);
  const cpuOnly: AzureMonitorMetricsResponse = response([
    metric("UsageNanoCores", [{ data: [{ timeStamp: new Date("2026-10-17T04:00:00Z"), average: 500_000_000 }] }], "NanoCores"),
  ]);

  assert.deepEqual(normalizeAzureMonitorResponse(empty).points, []);
  assert.deepEqual(normalizeAzureMonitorResponse(cpuOnly).points, [
    { timestamp: "2026-10-17T04:00:00.000Z", cpuCores: 0.5, memoryMiB: null, replicas: null },
  ]);
});

test("rejects resource IDs outside the configured subscription before calling Azure", async (): Promise<void> => {
  const calls: MetricsCall[] = [];
  const reader: AzureMonitorMetricsReader = readerWithResponse(response([]), calls);

  await assert.rejects(reader.read(RESOURCE_ID.replace("/subscriptions/sub/", "/subscriptions/other/"), "1h"), {
    name: "DeploymentMetricsReaderError",
  });
  assert.equal(calls.length, 0);
});

test("does not require Azure subscription configuration until metrics are requested", async (): Promise<void> => {
  const calls: MetricsCall[] = [];
  const client: AzureMonitorMetricsClient = {
    list: async (resourceId: string, options?: MetricsListOptionalParams): Promise<AzureMonitorMetricsResponse> => {
      calls.push({ resourceId, options });
      return response([]);
    },
  };
  const reader: AzureMonitorMetricsReader = new AzureMonitorMetricsReader(new ConfigService({}), client);

  await assert.rejects(reader.read(RESOURCE_ID, "1h"), (error: unknown): boolean =>
    error instanceof DeploymentMetricsReaderError && error.kind === "configuration_missing");
  assert.equal(calls.length, 0);
});

test("maps Azure 403, 404, 429, and 5xx responses to safe provider errors", async (): Promise<void> => {
  const failures: { statusCode: number; kind: string }[] = [
    { statusCode: 401, kind: "access_denied" },
    { statusCode: 403, kind: "access_denied" },
    { statusCode: 404, kind: "resource_not_found" },
    { statusCode: 429, kind: "rate_limited" },
    { statusCode: 503, kind: "unavailable" },
  ];

  for (let failureIndex: number = 0; failureIndex < failures.length; failureIndex += 1) {
    const failure: { statusCode: number; kind: string } = failures[failureIndex]!;
    const client: AzureMonitorMetricsClient = {
      list: async (): Promise<AzureMonitorMetricsResponse> => {
        throw Object.assign(new Error("sensitive Azure response"), { statusCode: failure.statusCode });
      },
    };
    const config: ConfigService = new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub" });
    const reader: AzureMonitorMetricsReader = new AzureMonitorMetricsReader(config, client);

    await assert.rejects(reader.read(RESOURCE_ID, "1h"), (error: unknown): boolean =>
      error instanceof DeploymentMetricsReaderError && error.kind === failure.kind && !error.message.includes("sensitive"));
  }
});
