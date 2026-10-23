import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import {
  GetRoleCatalogCase,
  GetUserRoleAssignmentsCase,
  ManageRolesCase,
  ReplaceUserRolesCase,
  type RoleWriteInput,
  type UserRoleAssignments,
} from "@kumo/application";
import { Permission, Role, User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { CheckPermissionsCase } from "@kumo/application";
import { RolesController } from "../dist/controllers/Roles.controller.js";
import { UserRolesController } from "../dist/controllers/UserRoles.controller.js";

test("role management routes enforce RoleManage, validate writes, and serialize exact assignments", async (context: TestContext): Promise<void> => {
  const createdAt: Date = new Date("2026-01-01T00:00:00.000Z");
  const target: User = new User({ id: "456", displayName: "Bob", suspended: false });
  let authenticated: boolean = true;
  let active: boolean = true;
  let suspended: boolean = false;
  const actorRoles: Role[] = [new Role({ id: "operator", name: "Operator", permission: 1n << BigInt(Permission.RoleManage.offset) })];
  let creates: number = 0;
  let replaces: number = 0;
  let deactivates: number = 0;
  let reads: number = 0;
  let assignments: number = 0;
  let lastInput: RoleWriteInput | null = null;
  let lastActor: string | null = null;
  let lastUserId: string | null = null;
  let lastRoleIds: readonly string[] = [];

  const role: Role = new Role({ id: "support", name: "Support", permission: 1n << BigInt(Permission.DeploymentRead.offset), createdAt });
  const manage: Pick<ManageRolesCase, "create" | "replace" | "deactivate"> = {
    create: async (input: RoleWriteInput, actorId: string): Promise<Role> => {
      creates += 1;
      lastInput = input;
      lastActor = actorId;
      return new Role({ ...input, createdAt });
    },
    replace: async (input: RoleWriteInput, actorId: string): Promise<Role> => {
      replaces += 1;
      lastInput = input;
      lastActor = actorId;
      return new Role({ ...input, createdAt });
    },
    deactivate: async (id: string, actorId: string): Promise<Role> => {
      deactivates += 1;
      lastActor = actorId;
      return new Role({ id, name: "Support", active: false, createdAt });
    },
  };
  const getAssignments: Pick<GetUserRoleAssignmentsCase, "exec"> = {
    exec: async (userId: string): Promise<UserRoleAssignments> => {
      reads += 1;
      lastUserId = userId;
      return { user: target, roles: [role] };
    },
  };
  const replaceAssignments: Pick<ReplaceUserRolesCase, "exec"> = {
    exec: async (input: { actorId: string; userId: string; roleIds: readonly string[] }): Promise<UserRoleAssignments> => {
      assignments += 1;
      lastActor = input.actorId;
      lastUserId = input.userId;
      lastRoleIds = input.roleIds;
      return { user: target, roles: [role] };
    },
  };

  class RolesModule {}
  Module({
    controllers: [RolesController, UserRolesController],
    providers: [
      {
        provide: GetRoleCatalogCase,
        useValue: new GetRoleCatalogCase({ findAll: async (): Promise<Role[]> => [role] }),
      },
      {
        provide: CheckPermissionsCase,
        useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => actorRoles }),
      },
      { provide: ManageRolesCase, useValue: manage },
      { provide: GetUserRoleAssignmentsCase, useValue: getAssignments },
      { provide: ReplaceUserRolesCase, useValue: replaceAssignments },
    ],
  })(RolesModule);

  const app: INestApplication = await NestFactory.create(RolesModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ id: "123", displayName: "Alice", active, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const json: { "content-type": string } = { "content-type": "application/json" };

  authenticated = false;
  assert.equal((await fetch(`${base}/roles`, { method: "POST", headers: json, body: JSON.stringify({ id: "support", name: "Support", active: true, permissions: [] }) })).status, 403);
  assert.equal(creates, 0);
  assert.equal((await fetch(`${base}/user/456/roles`)).status, 403);
  assert.equal(reads, 0);

  authenticated = true;
  active = false;
  assert.equal((await fetch(`${base}/roles`, { method: "POST", headers: json, body: JSON.stringify({ id: "support", name: "Support", active: true, permissions: [] }) })).status, 403);
  active = true;

  const invalid: globalThis.Response = await fetch(`${base}/roles`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ id: "support", name: "Support", active: true, permissions: ["NotAPermission"] }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(creates, 0);

  const create: globalThis.Response = await fetch(`${base}/roles`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ id: "support", name: "Support", active: true, permissions: ["DeploymentRead"] }),
  });
  assert.equal(create.status, 201, await create.clone().text());
  assert.equal(creates, 1);
  assert.equal(lastActor, "123");
  assert.deepEqual(lastInput, { id: "support", name: "Support", active: true, permission: 1n << BigInt(Permission.DeploymentRead.offset) });
  const created: { id: string; permissions: string[]; created_at: string } = await create.json();
  assert.deepEqual(created, { id: "support", name: "Support", active: true, permissions: ["DeploymentRead"], created_at: createdAt.toISOString() });

  const replace: globalThis.Response = await fetch(`${base}/roles/support`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ name: "Support team", active: true, permissions: [] }),
  });
  assert.equal(replace.status, 200);
  assert.equal(replaces, 1);
  assert.deepEqual(lastInput, { id: "support", name: "Support team", active: true, permission: 0n });

  const deactivate: globalThis.Response = await fetch(`${base}/roles/support`, { method: "DELETE" });
  assert.equal(deactivate.status, 204);
  assert.equal(deactivates, 1);

  const read: globalThis.Response = await fetch(`${base}/user/456/roles`);
  assert.equal(read.status, 200);
  assert.equal(reads, 1);
  assert.equal(lastUserId, "456");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  const readBody: { user: { id: string }; roles: { id: string }[] } = await read.json();
  assert.equal(readBody.user.id, "456");
  assert.deepEqual(readBody.roles.map((value: { id: string }): string => value.id), ["support"]);

  const write: globalThis.Response = await fetch(`${base}/user/456/roles`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ role_ids: ["support"] }),
  });
  assert.equal(write.status, 200);
  assert.equal(assignments, 1);
  assert.equal(lastActor, "123");
  assert.equal(lastUserId, "456");
  assert.deepEqual(lastRoleIds, ["support"]);

  const duplicate: globalThis.Response = await fetch(`${base}/user/456/roles`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ role_ids: ["support", "support"] }),
  });
  assert.equal(duplicate.status, 400);
  assert.equal(assignments, 1);
});
