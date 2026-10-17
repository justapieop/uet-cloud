import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment } from "@kumo/domain";
import type { DeploymentRepository } from "../dist/ports/deployment.js";
import { DeploymentNotFoundError } from "../dist/ports/deployment.js";
import { DeploymentMetricsUnavailableError, InvalidMetricsRangeError, type DeploymentMetrics, type DeploymentMetricsReader } from "../dist/ports/monitoring.js";
import { GetDeploymentMetricsCase } from "../dist/use-cases/deployment/GetDeploymentMetrics.case.js";

function fixture(deployment: Deployment | null): { useCase: GetDeploymentMetricsCase; calls: string[] } {
  const calls: string[] = [];
  const repository: DeploymentRepository = {
    findByIdAndUserId: async (id: string, userId: string): Promise<Deployment | null> =>
      deployment?.id === id && deployment.userId === userId ? deployment : null,
  } as DeploymentRepository;
  const reader: DeploymentMetricsReader = {
    read: async (input) => {
      calls.push(input.resourceId);
      assert.equal(input.start.toISOString(), "2026-10-17T08:00:00.000Z");
      assert.equal(input.end.toISOString(), "2026-10-17T09:00:00.000Z");
      return { deploymentId: input.deploymentId, intervalSeconds: 60, aggregation: "Average", cpuUnit: "cores", memoryUnit: "MiB", cpu: [], memory: [], replicas: [] };
    },
  };
  return { useCase: new GetDeploymentMetricsCase(repository, reader), calls };
}

function deployment(status: "RUNNING" | "PENDING" | "DELETED", resourceId: string | null): Deployment {
  return new Deployment({ id: "id-1", userId: "123", name: "my-app", status, resourceId });
}

test("an owned running deployment reads its stored resource ID and fixed time range", async () => {
  const { useCase, calls }: { useCase: GetDeploymentMetricsCase; calls: string[] } = fixture(deployment("RUNNING", "/resource/id"));
  const result: DeploymentMetrics = await useCase.exec("id-1", "123", "1h", new Date("2026-10-17T09:00:00Z"));
  assert.equal(result.deploymentId, "id-1");
  assert.deepEqual(calls, ["/resource/id"]);
});

test("missing or other-owner deployment never calls Azure", async () => {
  const { useCase, calls }: { useCase: GetDeploymentMetricsCase; calls: string[] } = fixture(deployment("RUNNING", "/resource/id"));
  await assert.rejects(useCase.exec("missing", "123", "1h"), DeploymentNotFoundError);
  await assert.rejects(useCase.exec("id-1", "456", "1h"), DeploymentNotFoundError);
  assert.deepEqual(calls, []);
});

test("pending, deleted, or missing resource ID never calls Azure", async () => {
  const items: Deployment[] = [deployment("PENDING", null), deployment("DELETED", "/resource/id"), deployment("RUNNING", null)];
  for (let index: number = 0; index < items.length; index += 1) {
    const item: Deployment = items[index]!;
    const { useCase, calls }: { useCase: GetDeploymentMetricsCase; calls: string[] } = fixture(item);
    await assert.rejects(useCase.exec("id-1", "123", "1h"), DeploymentMetricsUnavailableError);
    assert.deepEqual(calls, []);
  }
});

test("an invalid time range is rejected before repository or Azure access", async () => {
  const { useCase, calls }: { useCase: GetDeploymentMetricsCase; calls: string[] } = fixture(deployment("RUNNING", "/resource/id"));
  await assert.rejects(useCase.exec("id-1", "123", "30d" as "1h"), InvalidMetricsRangeError);
  assert.deepEqual(calls, []);
});
