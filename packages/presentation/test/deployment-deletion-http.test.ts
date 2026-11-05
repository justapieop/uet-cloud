import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import {
  CheckPermissionsCase,
  CreateDeploymentCase,
  DeleteDeploymentCase,
  DeploymentNotFoundError,
  GetBuildCase,
  GetDeploymentCase,
  InvalidDeploymentStatusError,
  StartDeploymentCase,
  StopDeploymentCase,
  type DeleteDeploymentInput,
  type DeploymentReadResult,
} from "@kumo/application";
import { Deployment, Permission, Role, User, type DeploymentStatus, type PermissionDefinition } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { RouteReadCache } from "../dist/common/ReadCache.js";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";

const DEPLOYMENT_ID: string = "00000000-0000-4000-8000-000000000001";

test("deployment deletion HTTP contract requires both grants, scopes to the session owner, returns 202, and invalidates cache", async (context: TestContext): Promise<void> => {
  let roles: Role[] = [];
  let behavior: "accept" | "missing" | "busy" = "accept";
  let deleteCalls: number = 0;
  let progressStatus: DeploymentStatus = "DELETE_PENDING";
  const invalidatedUsers: string[] = [];
  const deletion: Pick<DeleteDeploymentCase, "exec"> = {
    exec: async (input: DeleteDeploymentInput): Promise<void> => {
      deleteCalls++;
      assert.equal(input.id, DEPLOYMENT_ID);
      if (input.userId !== "alice") throw new DeploymentNotFoundError("Deployment was not found");
      if (behavior === "missing") throw new DeploymentNotFoundError("Deployment was not found");
      if (behavior === "busy") throw new InvalidDeploymentStatusError("Deployment cannot be deleted while another lifecycle operation is active");
    },
  };
  const readDeployment: Pick<GetDeploymentCase, "exec"> = {
    exec: async (_id: string, _userId: string): Promise<DeploymentReadResult> => ({
      deployment: new Deployment({ id: DEPLOYMENT_ID, userId: "alice", name: "my-app", status: progressStatus }),
      configuration: null,
    }),
  };
  const checker: CheckPermissionsCase = new CheckPermissionsCase({
    findActiveByUserId: async (userId: string): Promise<Role[]> => userId === "alice" ? roles : [],
  });
  const readCache: RouteReadCache = {
    invalidateDeployments: async (userId: string): Promise<void> => { invalidatedUsers.push(userId); },
  } as unknown as RouteReadCache;
  class FixtureModule {}
  Module({
    controllers: [DeploymentsController],
    providers: [
      { provide: CheckPermissionsCase, useValue: checker },
      { provide: CreateDeploymentCase, useValue: {} },
      { provide: DeleteDeploymentCase, useValue: deletion },
      { provide: GetDeploymentCase, useValue: readDeployment },
      { provide: GetBuildCase, useValue: {} },
      { provide: StartDeploymentCase, useValue: {} },
      { provide: StopDeploymentCase, useValue: {} },
      { provide: RouteReadCache, useValue: readCache },
      { provide: CACHE_MANAGER, useValue: { get: async (): Promise<undefined> => undefined, set: async (): Promise<void> => {} } },
    ],
  })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    const identity: string | undefined = request.get("x-test-user");
    request.user = identity ? new User({ id: identity, displayName: identity, active: true, suspended: false }) : undefined;
    request.isAuthenticated = ((): boolean => Boolean(request.user)) as Request["isAuthenticated"];
    next();
  });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/deployments/${DEPLOYMENT_ID}`;
  const remove: (identity?: string) => Promise<globalThis.Response> = (identity: string = "alice"): Promise<globalThis.Response> => fetch(url, {
    method: "DELETE",
    headers: identity ? { "x-test-user": identity } : {},
  });
  const grant: (...permissions: PermissionDefinition[]) => void = (...permissions: PermissionDefinition[]): void => {
    roles = permissions.map((permission: PermissionDefinition): Role => new Role({
      id: permission.name,
      name: permission.name,
      permission: 1n << BigInt(permission.offset),
    }));
  };

  assert.equal((await remove("")).status, 403);
  grant();
  assert.equal((await remove()).status, 403);
  grant(Permission.DeploymentDelete);
  assert.equal((await remove()).status, 403);
  grant(Permission.DeploymentRead);
  assert.equal((await remove()).status, 403);
  assert.equal(deleteCalls, 0);

  grant(Permission.DeploymentDelete, Permission.DeploymentRead);
  const accepted: globalThis.Response = await remove();
  assert.equal(accepted.status, 202);
  assert.match(accepted.headers.get("cache-control") ?? "", /private/);
  assert.deepEqual(invalidatedUsers, ["alice"]);
  const progressStatuses: readonly DeploymentStatus[] = ["DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"];
  for (let index: number = 0; index < progressStatuses.length; index++) {
    const status: DeploymentStatus = progressStatuses[index]!;
    progressStatus = status;
    const progress: globalThis.Response = await fetch(url, {
      headers: { "x-test-user": "alice", "cache-control": "no-store" },
    });
    assert.equal(progress.status, 200);
    const progressBody: { readonly status?: unknown } = await progress.json() as { readonly status?: unknown };
    assert.equal(progressBody.status, status);
  }
  const retry: globalThis.Response = await remove();
  assert.equal(retry.status, 202);
  assert.deepEqual(invalidatedUsers, ["alice", "alice"]);

  const callsBeforeInvalidId: number = deleteCalls;
  const malformed: globalThis.Response = await fetch(`${await app.getUrl()}/deployments/not-a-uuid`, {
    method: "DELETE",
    headers: { "x-test-user": "alice" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(deleteCalls, callsBeforeInvalidId);

  behavior = "missing";
  assert.equal((await remove()).status, 404);
  behavior = "busy";
  assert.equal((await remove()).status, 409);
});

test("deployment deletion HTTP contract does not expose another owner's deployment", async (context: TestContext): Promise<void> => {
  const roles: Role[] = [new Role({
    id: "delete-and-read",
    name: "Delete and read",
    permission: (1n << BigInt(Permission.DeploymentDelete.offset)) | (1n << BigInt(Permission.DeploymentRead.offset)),
  })];
  let calls: number = 0;
  let requestedOwner: string | undefined;
  const checker: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => roles });
  const deletion: Pick<DeleteDeploymentCase, "exec"> = {
    exec: async (input: DeleteDeploymentInput): Promise<void> => {
      calls++;
      requestedOwner = input.userId;
      throw new DeploymentNotFoundError("Deployment was not found");
    },
  };
  const readCache: RouteReadCache = { invalidateDeployments: async (): Promise<void> => {} } as unknown as RouteReadCache;
  class FixtureModule {}
  Module({
    controllers: [DeploymentsController],
    providers: [
      { provide: CheckPermissionsCase, useValue: checker },
      { provide: CreateDeploymentCase, useValue: {} },
      { provide: DeleteDeploymentCase, useValue: deletion },
      { provide: GetDeploymentCase, useValue: {} },
      { provide: GetBuildCase, useValue: {} },
      { provide: StartDeploymentCase, useValue: {} },
      { provide: StopDeploymentCase, useValue: {} },
      { provide: RouteReadCache, useValue: readCache },
      { provide: CACHE_MANAGER, useValue: { get: async (): Promise<undefined> => undefined, set: async (): Promise<void> => {} } },
    ],
  })(FixtureModule);
  const app: INestApplication = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = new User({ id: "bob", displayName: "Bob", active: true, suspended: false });
    request.isAuthenticated = ((): boolean => true) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const response: globalThis.Response = await fetch(`${await app.getUrl()}/deployments/${DEPLOYMENT_ID}`, { method: "DELETE" });
  assert.equal(response.status, 404);
  assert.equal(calls, 1);
  assert.equal(requestedOwner, "bob");
});
