import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, HttpException } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import { validate, type ValidationError } from "class-validator";
import { instanceToPlain } from "class-transformer";
import type { Request } from "express";
import {
  GetDeploymentCase,
  GetDeploymentMetricsCase as GetDeploymentMetricsToken,
  DeploymentMetricsReaderError,
  DeploymentNotFoundError,
} from "@kumo/application";
import type {
  DeploymentMetricsRange,
  DeploymentMetricsSnapshot,
} from "@kumo/application";
import type { CreateDeploymentCase } from "@kumo/application";
import { DeploymentMetricsUnavailableError } from "@kumo/application";
import { AzureMonitorMetricsReader, AzureMonitorModule } from "@kumo/infrastructure";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentMetricsQueryDto, type DeploymentMetricsResponseDto } from "../dist/dto/DeploymentMetrics.dto.js";
import { DeploymentModule } from "../dist/modules/Deployment.module.js";

const DEPLOYMENT_ID: string = "123e4567-e89b-12d3-a456-426614174000";
const SNAPSHOT: DeploymentMetricsSnapshot = {
  intervalSeconds: 60,
  cpuUnit: "cores",
  memoryUnit: "MiB",
  replicaUnit: "count",
  aggregation: {
    cpu: "average-per-pod-series-summed-across-pods-and-revisions",
    memory: "average-per-pod-series-summed-across-pods-and-revisions",
    replicas: "maximum-per-revision-summed-across-revisions",
  },
  points: [{ timestamp: "2026-10-17T08:01:00.000Z", cpuCores: 0.15, memoryMiB: 220.5, replicas: 2 }],
};

type MetricsExec = (
  deploymentId: string,
  userId: string,
  range: DeploymentMetricsRange,
) => Promise<DeploymentMetricsSnapshot>;

function controller(exec: MetricsExec): DeploymentsController {
  const createDeployment: CreateDeploymentCase = {} as unknown as CreateDeploymentCase;
  const getDeployment: GetDeploymentCase = {} as unknown as GetDeploymentCase;
  const getMetrics: GetDeploymentMetricsToken = { exec } as unknown as GetDeploymentMetricsToken;
  return new DeploymentsController(createDeployment, getDeployment, getMetrics);
}

function request(userId: string, suspended: boolean = false): Request {
  return { user: { id: userId, suspended } } as unknown as Request;
}

async function errorStatus(action: Promise<unknown>): Promise<number> {
  const failure: unknown = await action.catch((error: unknown): unknown => error);
  assert.ok(failure instanceof HttpException);
  return failure.getStatus();
}

test("returns a snake_case response DTO for a successful authenticated request", async (): Promise<void> => {
  const metricsController: DeploymentsController = controller(async (id: string, userId: string, range: DeploymentMetricsRange): Promise<DeploymentMetricsSnapshot> => {
    assert.equal(id, DEPLOYMENT_ID);
    assert.equal(userId, "owner-id");
    assert.equal(range, "1h");
    return SNAPSHOT;
  });

  const result: DeploymentMetricsResponseDto = await metricsController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" });

  assert.equal(result.deploymentId, DEPLOYMENT_ID);
  assert.equal(result.intervalSeconds, 60);
  assert.equal(result.points[0]?.cpuCores, 0.15);
  assert.equal(result.points[0]?.memoryMiB, 220.5);
  assert.equal(result.points[0]?.replicas, 2);
  const serialized: Record<string, unknown> = instanceToPlain(result) as Record<string, unknown>;
  assert.equal(serialized.deployment_id, DEPLOYMENT_ID);
  assert.equal(serialized.interval_seconds, 60);
});

test("rejects missing or unsupported metric ranges", async (): Promise<void> => {
  const invalid: DeploymentMetricsQueryDto = Object.assign(new DeploymentMetricsQueryDto(), { range: "7d" });
  const missing: DeploymentMetricsQueryDto = new DeploymentMetricsQueryDto();
  const invalidErrors: ValidationError[] = await validate(invalid);
  const missingErrors: ValidationError[] = await validate(missing);

  assert.equal(invalidErrors.some((error: ValidationError): boolean => error.property === "range"), true);
  assert.equal(missingErrors.some((error: ValidationError): boolean => error.property === "range"), true);
});

test("rejects missing and suspended users before invoking the metrics use case", async (): Promise<void> => {
  let callCount: number = 0;
  const metricsController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    callCount += 1;
    return SNAPSHOT;
  });

  await assert.rejects(metricsController.metrics(request("owner-id", true), DEPLOYMENT_ID, { range: "1h" }), ForbiddenException);
  await assert.rejects(metricsController.metrics({} as Request, DEPLOYMENT_ID, { range: "1h" }), ForbiddenException);
  assert.equal(callCount, 0);
});

test("maps owner-scoped and deployment readiness failures to 404 and 409", async (): Promise<void> => {
  const missingController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    throw new DeploymentNotFoundError("Deployment was not found");
  });
  const pendingController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    throw new DeploymentMetricsUnavailableError();
  });

  assert.equal(await errorStatus(missingController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" })), 404);
  assert.equal(await errorStatus(pendingController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" })), 409);
});

test("maps Azure throttling to 503 and other Azure failures to a safe 502", async (): Promise<void> => {
  const throttledController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    throw new DeploymentMetricsReaderError("rate_limited");
  });
  const deniedController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    throw new DeploymentMetricsReaderError("access_denied");
  });

  assert.equal(await errorStatus(throttledController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" })), 503);
  assert.equal(await errorStatus(deniedController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" })), 502);
});

test("reports missing Azure Monitor configuration as service unavailable", async (): Promise<void> => {
  const missingConfigController: DeploymentsController = controller(async (): Promise<DeploymentMetricsSnapshot> => {
    throw new DeploymentMetricsReaderError("configuration_missing");
  });

  assert.equal(await errorStatus(missingConfigController.metrics(request("owner-id"), DEPLOYMENT_ID, { range: "1h" })), 503);
});

test("wires the metrics use case and Azure adapter through Nest module providers", (): void => {
  const deploymentProviders: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DeploymentModule) as unknown[];
  const metricsProvider: { provide: unknown; inject: readonly unknown[] } | undefined = deploymentProviders.find(
    (provider: unknown): provider is { provide: unknown; inject: readonly unknown[] } =>
      typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === GetDeploymentMetricsToken && "inject" in provider,
  ) as { provide: unknown; inject: readonly unknown[] } | undefined;
  const deploymentImports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, DeploymentModule) as unknown[];
  const azureProviders: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AzureMonitorModule) as unknown[];
  const readerProvider: { provide: unknown; inject: readonly unknown[]; useFactory: unknown } | undefined = azureProviders.find(
    (provider: unknown): provider is { provide: unknown; inject: readonly unknown[]; useFactory: unknown } =>
      typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === AzureMonitorMetricsReader && "inject" in provider && "useFactory" in provider,
  ) as { provide: unknown; inject: readonly unknown[]; useFactory: unknown } | undefined;

  assert.equal(deploymentImports.includes(AzureMonitorModule), true);
  assert.deepEqual(metricsProvider?.inject, [GetDeploymentCase, AzureMonitorMetricsReader]);
  assert.deepEqual(readerProvider?.inject, [ConfigService]);
  assert.equal(typeof readerProvider?.useFactory, "function");
});
