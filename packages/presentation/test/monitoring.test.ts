import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { BadGatewayException, ConflictException, ForbiddenException, Module, NotFoundException, ServiceUnavailableException, type INestApplicationContext, type Provider } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { plainToInstance, instanceToPlain } from "class-transformer";
import { validate } from "class-validator";
import type { Request } from "express";
import { DeploymentMetricsReadError, DeploymentMetricsUnavailableError, DeploymentNotFoundError, GetDeploymentMetricsCase } from "@kumo/application";
import { AzureMonitorMetricsReader, InfraDeploymentRepository } from "@kumo/infrastructure";
import { MonitorClient } from "@azure/arm-monitor";
import { ConfigService } from "@nestjs/config";
import type { FactoryProvider } from "@nestjs/common";
import { DeploymentMetricsController } from "../dist/controllers/DeploymentMetrics.controller.js";
import { DeploymentMetricsQueryDto, DeploymentMetricsResponseDto } from "../dist/dto/DeploymentMetrics.dto.js";
import { MonitoringModule } from "../dist/modules/Monitoring.module.js";
import { DatabaseModule } from "../dist/modules/Database.module.js";
import { RouteReadCache } from "../dist/common/ReadCache.js";
import type { Cache } from "cache-manager";

function request(user?: { id: string; suspended: boolean }): Request {
  return { user } as Request;
}

test("controller rejects unauthenticated and suspended users before the use case", async () => {
  let calls: number = 0;
  const useCase: GetDeploymentMetricsCase = { exec: async () => { calls += 1; throw new Error("unexpected"); } } as unknown as GetDeploymentMetricsCase;
  const controller: DeploymentMetricsController = new DeploymentMetricsController(useCase);
  await assert.rejects(controller.get(request(), "id", { range: "1h" }), ForbiddenException);
  await assert.rejects(controller.get(request({ id: "123", suspended: true }), "id", { range: "1h" }), ForbiddenException);
  assert.equal(calls, 0);
});

test("controller converts Azure throttling to 503 without returning SDK details", async () => {
  const useCase: GetDeploymentMetricsCase = { exec: async () => { throw new DeploymentMetricsReadError("throttled"); } } as unknown as GetDeploymentMetricsCase;
  const controller: DeploymentMetricsController = new DeploymentMetricsController(useCase);
  await assert.rejects(controller.get(request({ id: "123", suspended: false }), "id", { range: "1h" }), ServiceUnavailableException);
});

test("controller maps missing, unready, forbidden Azure, and unavailable Azure states", async () => {
  const userRequest: Request = request({ id: "123", suspended: false });
  const cases: { error: Error; expected: new (...args: never[]) => Error }[] = [
    { error: new DeploymentNotFoundError("missing"), expected: NotFoundException },
    { error: new DeploymentMetricsUnavailableError("unready"), expected: ConflictException },
    { error: new DeploymentMetricsReadError("forbidden"), expected: BadGatewayException },
    { error: new DeploymentMetricsReadError("unavailable"), expected: ServiceUnavailableException },
  ];
  for (let index: number = 0; index < cases.length; index += 1) {
    const item: { error: Error; expected: new (...args: never[]) => Error } = cases[index]!;
    const useCase: GetDeploymentMetricsCase = { exec: async () => { throw item.error; } } as unknown as GetDeploymentMetricsCase;
    await assert.rejects(new DeploymentMetricsController(useCase).get(userRequest, "id", { range: "1h" }), item.expected);
  }
});

test("range validation and DTO serialization follow the HTTP contract", async () => {
  assert.equal((await validate(plainToInstance(DeploymentMetricsQueryDto, { range: "30d" }))).length, 1);
  assert.equal((await validate(plainToInstance(DeploymentMetricsQueryDto, {}))).length, 0);
  const dto: DeploymentMetricsResponseDto = new DeploymentMetricsResponseDto({
    deploymentId: "id", intervalSeconds: 60, aggregation: "Average", cpuUnit: "cores", memoryUnit: "MiB",
    cpu: [{ revisionName: "rev-a", replicaName: "pod-a", points: [{ timestamp: "2026-10-17T08:00:00.000Z", value: 0.15 }] }],
    memory: [], replicas: [],
  });
  const json: Record<string, unknown> = instanceToPlain(dto) as Record<string, unknown>;
  assert.equal(json.deployment_id, "id");
  assert.equal(json.interval_seconds, 60);
  assert.equal(json.cpu_unit, "cores");
  assert.deepEqual((json.cpu as Record<string, unknown>[])[0]?.revision_name, "rev-a");
});

test("monitoring module wires the existing repository and Infrastructure adapter", () => {
  const imports: unknown[] = Reflect.getMetadata("imports", MonitoringModule) as unknown[];
  const providers: { provide?: unknown; inject?: unknown[] }[] = Reflect.getMetadata("providers", MonitoringModule) as { provide?: unknown; inject?: unknown[] }[];
  assert.ok(imports.includes(DatabaseModule));
  assert.deepEqual(providers.find((provider) => provider.provide === GetDeploymentMetricsCase)?.inject, [InfraDeploymentRepository, AzureMonitorMetricsReader]);
  assert.deepEqual(providers.find((provider) => provider.provide === AzureMonitorMetricsReader)?.inject, [ConfigService, MonitorClient]);
});

test("Nest resolves the monitoring use case factory with repository and reader providers", async () => {
  const factories: FactoryProvider[] = Reflect.getMetadata("providers", MonitoringModule) as FactoryProvider[];
  const providers: Provider[] = factories.filter((provider: FactoryProvider): boolean => provider.provide !== MonitorClient);
  class FixtureModule {}
  Module({ providers: [
    { provide: InfraDeploymentRepository, useValue: {} },
    { provide: ConfigService, useValue: new ConfigService({ AZURE_SUBSCRIPTION_ID: "sub", AZURE_PLATFORM_RESOURCE_GROUP: "platform" }) },
    { provide: MonitorClient, useValue: { metrics: { list: async (): Promise<never> => { throw new Error("Must not call Azure"); } } } },
    ...providers,
  ] })(FixtureModule);
  const context: INestApplicationContext = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  try {
    assert.ok(context.get(GetDeploymentMetricsCase) instanceof GetDeploymentMetricsCase);
  } finally {
    await context.close();
  }
});

test("monitoring cache keys separate users, deployments, and ranges", async () => {
  const cache: RouteReadCache = new RouteReadCache({ get: async () => undefined } as unknown as Cache);
  const first: string | undefined = await cache.key("123", "monitoring", "/deployments/id-a/metrics?range=1h");
  assert.ok(first);
  assert.notEqual(first, await cache.key("456", "monitoring", "/deployments/id-a/metrics?range=1h"));
  assert.notEqual(first, await cache.key("123", "monitoring", "/deployments/id-b/metrics?range=1h"));
  assert.notEqual(first, await cache.key("123", "monitoring", "/deployments/id-a/metrics?range=6h"));
  assert.notEqual(first, await cache.key("123", "deployments", "/deployments/id-a/metrics?range=1h"));
});
