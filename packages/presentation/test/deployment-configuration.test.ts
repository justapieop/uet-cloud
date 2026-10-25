import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Module, ClassSerializerInterceptor, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Deployment, Role, User } from "@kumo/domain";
import { CheckPermissionsCase, CreateDeploymentCase, GetBuildCase, GetDeploymentCase, StartDeploymentCase, StopDeploymentCase,
  DeploymentConfigurationReadError, type DeploymentConfiguration } from "@kumo/application";
import type { NextFunction, Request, Response } from "express";
import { emptyRepositories } from "../../application/test/support/repositories.ts";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { RouteReadCache } from "../dist/common/ReadCache.js";

test("GET detail and list serialize applied Azure values; failures never return saved configuration as live", async (context: TestContext): Promise<void> => {
  const id: string = "00000000-0000-4000-8000-000000000001";
  let saved: Deployment = new Deployment({ id, userId: "123", name: "my-app", status: "RUNNING", resourceId: "resource",
    image: "old-image", fqdn: "old.example.com", spec: { repo: "https://github.com/owner/repo", region: "eastus",
      targetPort: 80, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1, envVars: { SECRET: "hidden" } },
  });
  let applied: DeploymentConfiguration = { region: "japaneast", maxVcpu: 2, maxMemory: 4, minScaling: 1, maxScaling: 5,
    targetPort: 8080, external: true, additionalPorts: [{ targetPort: 9000, exposedPort: 9001, external: true }], image: "live-image", fqdn: "live.example.com" };
  let failure: DeploymentConfigurationReadError | null = null;
  let reads: number = 0;
  const useCase: GetDeploymentCase = new GetDeploymentCase({ ...emptyRepositories().deployment,
    findByIdAndUserId: async (): Promise<Deployment> => saved,
    findByUserId: async (): Promise<Deployment[]> => [saved],
  }, { read: async (): Promise<DeploymentConfiguration> => { reads++; if (failure) throw failure; return applied; } });
  class FixtureModule {}
  Module({ controllers: [DeploymentsController], providers: [
    { provide: GetDeploymentCase, useValue: useCase },
    { provide: CreateDeploymentCase, useValue: {} }, { provide: StartDeploymentCase, useValue: {} },
    { provide: StopDeploymentCase, useValue: {} }, { provide: GetBuildCase, useValue: {} },
    { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => [new Role({ id: "reader", name: "Reader", permission: 2n })] }) },
    RouteReadCache,
    { provide: CACHE_MANAGER, useValue: { get: async (): Promise<undefined> => undefined, set: async (): Promise<void> => {} } },
  ] })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = new User({ id: "123", displayName: "Alice", suspended: false });
    request.isAuthenticated = ((): boolean => true) as Request["isAuthenticated"]; next();
  });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const base: string = `${await app.getUrl()}/deployments`;
  const response: globalThis.Response = await fetch(`${base}/${id}`);
  assert.equal(response.status, 200);
  const body: Record<string, unknown> = await response.json() as Record<string, unknown>;
  assert.equal(body.region, "japaneast"); assert.equal(body.max_vcpu, 2); assert.equal(body.max_memory, 4);
  assert.equal(body.min_scaling, 1); assert.equal(body.max_scaling, 5); assert.equal(body.target_port, 8080);
  assert.equal(body.external, true); assert.equal(body.image, "live-image"); assert.equal(body.fqdn, "live.example.com");
  assert.deepEqual(body.additional_ports, [{ target_port: 9000, exposed_port: 9001, external: true }]);
  assert.equal(body.spec, undefined); assert.ok(!JSON.stringify(body).includes("hidden"));
  assert.deepEqual(await (await fetch(`${base}?region=japaneast`)).json(), [body]);
  assert.deepEqual(await (await fetch(`${base}?region=eastus`)).json(), []);
  applied = { ...applied, external: false, image: null, fqdn: null, maxVcpu: null, maxMemory: null };
  const absent: Record<string, unknown> = await (await fetch(`${base}/${id}`)).json() as Record<string, unknown>;
  assert.equal(absent.external, false); assert.equal(absent.image, null); assert.equal(absent.fqdn, null); assert.equal(absent.max_vcpu, null);
  failure = new DeploymentConfigurationReadError("unavailable");
  assert.equal((await fetch(`${base}/${id}`)).status, 503);
  assert.equal((await fetch(base)).status, 503);
  failure = new DeploymentConfigurationReadError("missing");
  assert.equal((await fetch(`${base}/${id}`)).status, 502);
  saved = new Deployment({ ...saved.getDetails(), status: "PENDING", resourceId: null });
  const readsBeforePending: number = reads;
  const pending: Record<string, unknown> = await (await fetch(`${base}/${id}`)).json() as Record<string, unknown>;
  assert.equal(pending.external, true); assert.equal(pending.max_vcpu, 0.5); assert.equal(pending.region, "eastus");
  assert.equal(reads, readsBeforePending);
});
