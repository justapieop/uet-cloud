import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { CheckPermissionsCase, GetRoleCatalogCase, ManageRolesCase } from "@kumo/application";
import { Permission, Role, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { RolesController } from "../dist/controllers/Roles.controller.js";

test("role catalog requires RoleManage and returns exact stored grants and permission metadata", async (context: TestContext): Promise<void> => {
  const createdAt: Date = new Date("2026-01-01T00:00:00.000Z");
  let listedRoles: Role[] = [
    new Role({ id: "admin", name: "Administrator", permission: 1n, createdAt }),
    new Role({ id: "viewer", name: "Viewer", permission: 1n << BigInt(Permission.DeploymentRead.offset), active: false, createdAt }),
  ];
  let authenticated: boolean = true;
  let active: boolean = true;
  let suspended: boolean = false;
  let reads: number = 0;
  const actorRoles: Role[] = [];

  class RolesModule {}
  Module({
    controllers: [RolesController],
    providers: [
      {
        provide: GetRoleCatalogCase,
        useValue: new GetRoleCatalogCase({
          findAll: async (): Promise<Role[]> => {
            reads += 1;
            return listedRoles;
          },
        }),
      },
      {
        provide: CheckPermissionsCase,
        useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => actorRoles }),
      },
      { provide: ManageRolesCase, useValue: {} },
    ],
  })(RolesModule);

  const app: INestApplication = await NestFactory.create(RolesModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ id: "123", displayName: "Alice", active, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();

  authenticated = false;
  assert.equal((await fetch(`${base}/roles`)).status, 403);
  assert.equal(reads, 0);

  authenticated = true;
  actorRoles.push(new Role({ id: "operator", name: "Operator", permission: 1n << BigInt(Permission.DeploymentRead.offset) }));
  assert.equal((await fetch(`${base}/roles`)).status, 403);
  assert.equal(reads, 0);

  actorRoles.splice(0, actorRoles.length, new Role({ id: "operator", name: "Operator", permission: 1n << BigInt(Permission.RoleManage.offset) }));
  const response: globalThis.Response = await fetch(`${base}/roles`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(reads, 1);

  const body: {
    roles: { id: string; name: string; active: boolean; permissions: string[]; created_at: string }[];
    permissions: { key: string; name: string; description: string; requires: string[] }[];
  } = await response.json();
  assert.deepEqual(body.roles, [
    { id: "admin", name: "Administrator", active: true, permissions: ["Super"], created_at: createdAt.toISOString() },
    { id: "viewer", name: "Viewer", active: false, permissions: ["DeploymentRead"], created_at: createdAt.toISOString() },
  ]);
  const update: { key: string; requires: string[] } = body.permissions.find((permission: { key: string }): boolean => permission.key === "DeploymentUpdate")!;
  assert.deepEqual(update.requires, ["DeploymentRead"]);
  assert.equal(body.permissions.at(-1)?.key, "RoleManage");

  active = false;
  assert.equal((await fetch(`${base}/roles`)).status, 403);
  active = true;
  suspended = true;
  assert.equal((await fetch(`${base}/roles`)).status, 403);
  suspended = false;

  actorRoles.splice(0, actorRoles.length, new Role({ id: "admin", name: "Administrator", permission: 1n }));
  assert.equal((await fetch(`${base}/roles`)).status, 200);
  assert.equal(reads, 2);
});
