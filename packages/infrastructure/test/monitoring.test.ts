import assert from "node:assert/strict";
import { test } from "node:test";
import { Module, type INestApplicationContext } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { Response } from "@azure/arm-monitor";
import { DeploymentMetricsReadError, InvalidDeploymentResourceError, type DeploymentMetrics } from "@kumo/application";
import { AzureMonitorMetricsReader, type MetricsClient, type MetricsReadInput } from "../dist/azure/monitoring.js";
import { AzureMonitoringModule } from "../dist/azure/Monitoring.module.js";

const RESOURCE_ID: string = "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app";
const INPUT: MetricsReadInput = {
  resourceId: RESOURCE_ID, deploymentId: "deployment-1", userId: "123", appName: "my-app",
  start: new Date("2026-10-17T08:00:00Z"), end: new Date("2026-10-17T09:00:00Z"),
};

function metricResponse(name: string, series: { revision: string; replica?: string; average?: number | null }[]): Response {
  return {
    timespan: "2026-10-17T08:00:00Z/2026-10-17T09:00:00Z", interval: "PT1M",
    value: [{
      id: name, type: "Microsoft.App/containerapps", name: { value: name }, unit: name === "Replicas" ? "Count" : name === "UsageNanoCores" ? "NanoCores" : "Bytes",
      timeseries: series.map((entry) => ({
        metadatavalues: [
          { name: { value: "revisionName" }, value: entry.revision },
          ...(entry.replica ? [{ name: { value: "podName" }, value: entry.replica }] : []),
        ],
        data: [{ timeStamp: new Date("2026-10-17T08:00:00Z"), average: entry.average ?? undefined }],
      })),
    }],
  };
}

function fixture(responses: Record<string, Response>, failStatus?: number): { reader: AzureMonitorMetricsReader; calls: string[] } {
  const calls: string[] = [];
  const client: MetricsClient = {
    list: async (resourceId, options): Promise<Response> => {
      assert.equal(resourceId, RESOURCE_ID);
      assert.equal(options.metricnamespace, "Microsoft.App/containerapps");
      assert.equal(options.aggregation, "Average");
      assert.equal(options.interval, "PT1M");
      assert.equal(options.top, 1000);
      calls.push(options.metricnames);
      if (failStatus) throw { statusCode: failStatus, message: "secret Azure response" };
      return responses[options.metricnames]!;
    },
  };
  const reader: AzureMonitorMetricsReader = new AzureMonitorMetricsReader(
    new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform" }), client,
  );
  return { reader, calls };
}

test("Nest creates the Azure monitoring reader with ConfigService", async () => {
  class FixtureModule {}
  Module({ imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [(): Record<string, string> => ({
        AZURE_SUBSCRIPTION_ID: "sub",
        AZURE_PLATFORM_RESOURCE_GROUP: "platform",
      })],
    }),
    AzureMonitoringModule,
  ] })(FixtureModule);
  const context: INestApplicationContext = await NestFactory.createApplicationContext(FixtureModule, { logger: false });
  try {
    assert.ok(context.get(AzureMonitorMetricsReader) instanceof AzureMonitorMetricsReader);
  } finally {
    await context.close();
  }
});

test("reads separate replicas and revisions, converts units, and retains missing samples", async () => {
  const responses: Record<string, Response> = {
    UsageNanoCores: metricResponse("UsageNanoCores", [
      { revision: "rev-a", replica: "pod-1", average: 150_000_000 },
      { revision: "rev-a", replica: "pod-2", average: 250_000_000 },
      { revision: "rev-b", replica: "pod-3", average: null },
    ]),
    WorkingSetBytes: metricResponse("WorkingSetBytes", [
      { revision: "rev-a", replica: "pod-1", average: 220 * 1_048_576 },
      { revision: "rev-b", replica: "pod-3", average: 240 * 1_048_576 },
    ]),
    Replicas: metricResponse("Replicas", [
      { revision: "rev-a", average: 2 }, { revision: "rev-b", average: 0 },
    ]),
  };
  const { reader, calls }: { reader: AzureMonitorMetricsReader; calls: string[] } = fixture(responses);
  const result: DeploymentMetrics = await reader.read(INPUT);
  assert.deepEqual(calls.sort(), ["Replicas", "UsageNanoCores", "WorkingSetBytes"].sort());
  assert.equal(result.cpu[0]?.points[0]?.value, 0.15);
  assert.equal(result.cpu[1]?.points[0]?.value, 0.25);
  assert.equal(result.cpu[2]?.points[0]?.value, null);
  assert.equal(result.memory[0]?.points[0]?.value, 220);
  assert.equal(result.cpu[2]?.revisionName, "rev-b");
  assert.equal(result.replicas[1]?.points[0]?.value, 0);
  assert.equal(result.replicas[1]?.replicaName, null);
  assert.equal(result.cpu[0]?.points[0]?.timestamp, "2026-10-17T08:00:00.000Z");
});

test("empty Azure metrics are an empty successful result, not zero or failure", async () => {
  const responses: Record<string, Response> = {
    UsageNanoCores: metricResponse("UsageNanoCores", []),
    WorkingSetBytes: metricResponse("WorkingSetBytes", []),
    Replicas: metricResponse("Replicas", []),
  };
  const result: DeploymentMetrics = await fixture(responses).reader.read(INPUT);
  assert.deepEqual([result.cpu, result.memory, result.replicas], [[], [], []]);
});

test("rejects a resource outside the owned subscription, group, app, or type before Azure calls", async () => {
  const { reader, calls }: { reader: AzureMonitorMetricsReader; calls: string[] } = fixture({});
  const resourceIds: string[] = [
    RESOURCE_ID.replace("/sub/", "/other/"),
    RESOURCE_ID.replace("user-rg-123", "user-rg-456"),
    RESOURCE_ID.replace("my-app", "other-app"),
    RESOURCE_ID.replace("containerApps", "managedEnvironments"),
  ];
  for (let index: number = 0; index < resourceIds.length; index += 1) {
    const resourceId: string = resourceIds[index]!;
    await assert.rejects(reader.read({ ...INPUT, resourceId }), InvalidDeploymentResourceError);
  }
  assert.deepEqual(calls, []);
});

test("maps Azure 403, 429, and 5xx without exposing response text", async () => {
  const cases: readonly (readonly [number, "forbidden" | "throttled" | "unavailable"])[] = [[403, "forbidden"], [429, "throttled"], [503, "unavailable"]];
  for (let index: number = 0; index < cases.length; index += 1) {
    const pair: readonly [number, "forbidden" | "throttled" | "unavailable"] = cases[index]!;
    await assert.rejects(fixture({}, pair[0]).reader.read(INPUT), (error: unknown): boolean =>
      error instanceof DeploymentMetricsReadError && error.reason === pair[1] && !error.message.includes("secret"));
  }
});

test("rejects unexpected units or dimensionless series instead of reporting a false value", async () => {
  const wrongUnit: Response = metricResponse("UsageNanoCores", [{ revision: "rev-a", replica: "pod-1", average: 1 }]);
  wrongUnit.value[0]!.unit = "Bytes";
  const responses: Record<string, Response> = {
    UsageNanoCores: wrongUnit,
    WorkingSetBytes: metricResponse("WorkingSetBytes", []),
    Replicas: metricResponse("Replicas", []),
  };
  await assert.rejects(fixture(responses).reader.read(INPUT), DeploymentMetricsReadError);
  responses.UsageNanoCores = metricResponse("UsageNanoCores", [{ revision: "rev-a", average: 1 }]);
  await assert.rejects(fixture(responses).reader.read(INPUT), DeploymentMetricsReadError);
});
