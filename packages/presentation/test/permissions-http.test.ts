import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CheckPermissionsCase } from "@kumo/application";
import { Permission, Role, User, type PermissionDefinition } from "@kumo/domain";
import type { Request, Response, NextFunction } from "express";
import { RequirePermissions } from "../dist/common/RequirePermissions.decorator.js";

const WRITE: PermissionDefinition = { offset: 2, name: "Test write", description: "Test-only permission", requires: [] };

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
