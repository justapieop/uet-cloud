import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { BuildNotFound, CheckPermissionsCase, CreateDeploymentCase, DeploymentNotFoundError, GetBuildCase, GetDeploymentCase, GetDeploymentMetricsCase, StartDeploymentCase, StopDeploymentCase } from "@kumo/application";
import { Deployment, Permission, Role, User, type PermissionDefinition } from "@kumo/domain";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentMetricsController } from "../dist/controllers/DeploymentMetrics.controller.js";
import { RouteReadCache } from "../dist/common/ReadCache.js";
import type { Request, Response, NextFunction } from "express";
import { RequirePermissions } from "../dist/common/RequirePermissions.decorator.js";

const WRITE: PermissionDefinition = { offset: 2, name: "Test write", description: "Test-only permission", requires: [] };

test("resource routes check specific grants before lookups and cached responses", async (context: TestContext): Promise<void> => {
  let roles: Role[] = [];
  let calls: number = 0;
  let lifecycleSuccess: boolean = false;
  const cache: Map<string, unknown> = new Map();
  const missing: (id: string, userId: string) => Promise<never> = async (_id: string, userId: string): Promise<never> => {
    calls++; assert.equal(userId, "123"); throw new DeploymentNotFoundError();
  };
  const lifecycle: (input: { id: string; userId: string }) => Promise<Deployment> = async (input: { id: string; userId: string }): Promise<Deployment> => {
    if (!lifecycleSuccess) return missing(input.id, input.userId);
    calls++;
    return new Deployment({ id: input.id, userId: input.userId, name: "my-app", status: "RUNNING" });
  };
  class ResourceModule {}
  Module({
    controllers: [DeploymentsController, DeploymentMetricsController],
    providers: [
      { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles }) },
      { provide: CreateDeploymentCase, useValue: {} },
      { provide: StartDeploymentCase, useValue: { exec: lifecycle } },
      { provide: StopDeploymentCase, useValue: { exec: lifecycle } },
      { provide: GetDeploymentCase, useValue: { exec: missing,
        list: async (userId: string): Promise<Deployment[]> => { calls++; assert.equal(userId, "123"); return []; },
      } },
      { provide: GetBuildCase, useValue: { exec: async (_id: string, userId: string): Promise<never> => {
        calls++; assert.equal(userId, "123"); throw new BuildNotFound();
      } } },
      { provide: GetDeploymentMetricsCase, useValue: { exec: missing } },
      RouteReadCache,
      { provide: CACHE_MANAGER, useValue: {
        get: async (key: string): Promise<unknown> => cache.get(key),
        set: async (key: string, value: unknown): Promise<void> => { cache.set(key, value); },
      } },
    ],
  })(ResourceModule);
  const app: INestApplication = await NestFactory.create(ResourceModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = new User({ id: "123", displayName: "Alice", suspended: false });
    request.isAuthenticated = ((): boolean => true) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const id: string = "00000000-0000-4000-8000-000000000001";
  const routes: string[] = ["/deployments", `/deployments/${id}`, `/deployment/build/${id}`, `/deployments/${id}/metrics`];
  const grant: (...permissions: PermissionDefinition[]) => void = (...permissions: PermissionDefinition[]): void => {
    roles = permissions.map((permission: PermissionDefinition): Role => new Role({
      id: permission.name, name: permission.name, permission: 1n << BigInt(permission.offset),
    }));
  };
  for (const route of routes) assert.equal((await fetch(base + route)).status, 403);
  assert.equal(calls, 0);
  grant(Permission.DeploymentCreate);
  for (const route of routes) assert.equal((await fetch(base + route)).status, 403);
  assert.equal(calls, 0);
  grant(Permission.DeploymentRead);
  assert.equal((await fetch(base + routes[0])).status, 200);
  const cached: globalThis.Response = await fetch(base + routes[0]);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get("X-Cache"), "HIT");
  assert.equal(calls, 1);
  assert.equal((await fetch(base + routes[1])).status, 404);
  assert.equal((await fetch(base + routes[2])).status, 403);
  assert.equal((await fetch(base + routes[3])).status, 403);
  grant();
  assert.equal((await fetch(base + routes[0])).status, 403);
  assert.equal(calls, 2);
  grant(Permission.DeploymentMetricsRead);
  assert.equal((await fetch(base + routes[3])).status, 403);
  assert.equal(calls, 2);
  grant(Permission.DeploymentRead, Permission.DeploymentMetricsRead);
  assert.equal((await fetch(base + routes[3])).status, 404);
  grant(Permission.BuildRead);
  assert.equal((await fetch(base + routes[2])).status, 404);
  assert.equal((await fetch(base + routes[1])).status, 403);
  grant(Permission.Super);
  for (const route of routes.slice(1)) assert.equal((await fetch(base + route)).status, 404);
  const lifecycleGrants: readonly (PermissionDefinition | undefined)[] = [undefined, Permission.DeploymentRead, Permission.DeploymentUpdate, Permission.Super];
  for (let index: number = 0; index < lifecycleGrants.length; index++) {
    const permission: PermissionDefinition | undefined = lifecycleGrants[index];
    grant(...(permission ? [permission] : []));
    const before: number = calls;
    const allowed: boolean = permission === Permission.DeploymentUpdate || permission === Permission.Super;
    const actions: readonly string[] = ["start", "stop"];
    for (let actionIndex: number = 0; actionIndex < actions.length; actionIndex++) {
      const action: string = actions[actionIndex]!;
      assert.equal((await fetch(`${base}/deployments/${id}/${action}`, { method: "POST" })).status, allowed ? 404 : 403);
    }
    assert.equal(calls, before + (allowed ? 2 : 0));
  }
  lifecycleSuccess = true;
  for (let index: number = 0; index < 2; index++) {
    const action: string = index === 0 ? "start" : "stop";
    assert.equal((await fetch(`${base}/deployments/${id}/${action}`, { method: "POST" })).status, 202);
    const before: number = calls;
    assert.equal((await fetch(`${base}/deployments/invalid-id/${action}`, { method: "POST" })).status, 400);
    assert.equal(calls, before);
  }
});

test("permission decorator enforces role unions and additive controller/method policies over HTTP", async (context: TestContext): Promise<void> => {
  let roles: Role[] = [];
  let reads: number = 0;
  const checker: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (id: string): Promise<Role[]> => {
    assert.equal(id, "123"); reads++; return roles;
  } });
  class PermissionController {
    public read(): { ok: boolean } { return { ok: true }; }
    public write(): { ok: boolean } { return { ok: true }; }
  }
  Controller("permissions-test")(PermissionController);
  RequirePermissions(Permission.DeploymentRead)(PermissionController);
  Get("read")(PermissionController.prototype, "read", Object.getOwnPropertyDescriptor(PermissionController.prototype, "read")!);
  Get("write")(PermissionController.prototype, "write", Object.getOwnPropertyDescriptor(PermissionController.prototype, "write")!);
  RequirePermissions(WRITE)(PermissionController.prototype, "write", Object.getOwnPropertyDescriptor(PermissionController.prototype, "write")!);
  class FixtureModule {}
  Module({ controllers: [PermissionController], providers: [{ provide: CheckPermissionsCase, useValue: checker }] })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ id: "123", displayName: "Alice", active: identity !== "inactive", suspended: identity === "suspended" }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const get: (route: string, identity?: string) => Promise<globalThis.Response> = (route: string, identity: string = "alice"): Promise<globalThis.Response> =>
    fetch(`${base}/permissions-test/${route}`, { headers: identity ? { "x-test-user": identity } : {} });
  assert.equal((await get("read", "")).status, 403);
  assert.equal((await get("read", "inactive")).status, 403);
  assert.equal((await get("read", "suspended")).status, 403);
  assert.equal(reads, 0);
  assert.equal((await get("read")).status, 403);
  roles = [new Role({ id: "reader", name: "Reader", permission: 2n })];
  assert.equal((await get("read")).status, 200);
  assert.equal((await get("write")).status, 403);
  roles.push(new Role({ id: "writer", name: "Writer", permission: 4n }));
  assert.equal((await get("write")).status, 200);
  roles = [new Role({ id: "super", name: "Inactive Super", permission: 1n, active: false })];
  assert.equal((await get("write")).status, 403);
  roles = [new Role({ id: "super", name: "Super", permission: 1n })];
  assert.equal((await get("write")).status, 200);
  roles = [];
  assert.equal((await get("write")).status, 403);
});
