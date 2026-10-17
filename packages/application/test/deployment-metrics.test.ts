import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment } from "@kumo/domain";
import type { GetDeploymentCase } from "../dist/use-cases/deployment/GetDeployment.case.js";
import { DeploymentMetricsUnavailableError, GetDeploymentMetricsCase } from "../dist/use-cases/deployment/GetDeploymentMetrics.case.js";
import { DeploymentNotFoundError } from "../dist/ports/deployment.js";
import type {
  DeploymentMetricsRange,
  DeploymentMetricsReader,
  DeploymentMetricsSnapshot,
} from "../dist/ports/deployment-metrics.js";

const METRICS: DeploymentMetricsSnapshot = {
  intervalSeconds: 60,
  cpuUnit: "cores",
  memoryUnit: "MiB",
  replicaUnit: "count",
  aggregation: {
    cpu: "average-per-pod-series-summed-across-pods-and-revisions",
    memory: "average-per-pod-series-summed-across-pods-and-revisions",
    replicas: "maximum-per-revision-summed-across-revisions",
  },
  points: [],
};

function deployment(status: "PENDING" | "RUNNING", resourceId: string | null): Deployment {
  return new Deployment({ id: "deployment-id", userId: "owner-id", name: "sample-app", status, resourceId });
}

test("metrics are read for the owned running deployment's saved Azure resource", async (): Promise<void> => {
  const savedDeployment: Deployment = deployment("RUNNING", "/subscriptions/sub/resourceGroups/user-rg/providers/Microsoft.App/containerApps/sample-app");
  const readCalls: { resourceId: string; range: DeploymentMetricsRange }[] = [];
  const getDeployment: Pick<GetDeploymentCase, "exec"> = {
    exec: async (id: string, userId: string): Promise<Deployment> => {
      assert.equal(id, savedDeployment.id);
      assert.equal(userId, savedDeployment.userId);
      return savedDeployment;
    },
  };
  const reader: DeploymentMetricsReader = {
    read: async (resourceId: string, range: DeploymentMetricsRange): Promise<DeploymentMetricsSnapshot> => {
      readCalls.push({ resourceId, range });
      return METRICS;
    },
  };
  const useCase: GetDeploymentMetricsCase = new GetDeploymentMetricsCase(getDeployment, reader);

  const result: DeploymentMetricsSnapshot = await useCase.exec(savedDeployment.id, savedDeployment.userId, "6h");

  assert.equal(result, METRICS);
  assert.deepEqual(readCalls, [{ resourceId: savedDeployment.resourceId, range: "6h" }]);
});

test("metrics are not queried for a deployment that is not running", async (): Promise<void> => {
  let readCount: number = 0;
  const getDeployment: Pick<GetDeploymentCase, "exec"> = {
    exec: async (): Promise<Deployment> => deployment("PENDING", null),
  };
  const reader: DeploymentMetricsReader = {
    read: async (): Promise<DeploymentMetricsSnapshot> => {
      readCount += 1;
      return METRICS;
    },
  };
  const useCase: GetDeploymentMetricsCase = new GetDeploymentMetricsCase(getDeployment, reader);

  await assert.rejects(useCase.exec("deployment-id", "owner-id", "1h"), DeploymentMetricsUnavailableError);
  assert.equal(readCount, 0);
});

test("metrics are not queried when a running deployment has no saved resource ID", async (): Promise<void> => {
  let readCount: number = 0;
  const getDeployment: Pick<GetDeploymentCase, "exec"> = {
    exec: async (): Promise<Deployment> => deployment("RUNNING", null),
  };
  const reader: DeploymentMetricsReader = {
    read: async (): Promise<DeploymentMetricsSnapshot> => {
      readCount += 1;
      return METRICS;
    },
  };
  const useCase: GetDeploymentMetricsCase = new GetDeploymentMetricsCase(getDeployment, reader);

  await assert.rejects(useCase.exec("deployment-id", "owner-id", "1h"), DeploymentMetricsUnavailableError);
  assert.equal(readCount, 0);
});

test("owner-scoped lookup failure prevents an Azure metrics query", async (): Promise<void> => {
  let readCount: number = 0;
  const getDeployment: Pick<GetDeploymentCase, "exec"> = {
    exec: async (id: string, userId: string): Promise<Deployment> => {
      assert.equal(id, "deployment-id");
      assert.equal(userId, "different-user");
      throw new DeploymentNotFoundError("Deployment was not found");
    },
  };
  const reader: DeploymentMetricsReader = {
    read: async (): Promise<DeploymentMetricsSnapshot> => {
      readCount += 1;
      return METRICS;
    },
  };
  const useCase: GetDeploymentMetricsCase = new GetDeploymentMetricsCase(getDeployment, reader);

  await assert.rejects(useCase.exec("deployment-id", "different-user", "1h"), DeploymentNotFoundError);
  assert.equal(readCount, 0);
});
