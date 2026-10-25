import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { User, Permission } from "@kumo/domain";
import { CheckPermissionsCase, SESSION_PERMISSION_BITS, type SessionUser } from "@kumo/application";
import { SessionSerializer } from "@kumo/infrastructure";
import { PermissionsGuard } from "../dist/common/Permissions.guard.js";
import { REQUIRED_PERMISSIONS } from "../dist/common/Permissions.metadata.js";

test("fresh session grants avoid a second role lookup and reflect revocation on the next request", async (): Promise<void> => {
  let bits: bigint = 2n;
  let reads: number = 0;
  let user: User | undefined;
  const serializer: SessionSerializer = new SessionSerializer({ read: async () => {
    reads++; return { user: new User({ id: "123", displayName: "Alice", suspended: false }), permissionBits: bits };
  } });
  const restore: () => Promise<void> = (): Promise<void> => serializer.deserializeUser("123", (error: unknown, value?: User | false): void => {
    assert.equal(error, null); user = value || undefined;
  });
  const checker: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (): Promise<never> => { throw new Error("Must not make another role query"); } });
  const guard: PermissionsGuard = new PermissionsGuard(new Reflector(), checker);
  class Fixture { public read(): void {} }
  Reflect.defineMetadata(REQUIRED_PERMISSIONS, [Permission.DeploymentRead], Fixture.prototype.read);
  const context: ExecutionContext = { getClass: () => Fixture, getHandler: () => Fixture.prototype.read,
    switchToHttp: () => ({ getRequest: () => ({ user, isAuthenticated: (): boolean => true }) }),
  } as unknown as ExecutionContext;
  await restore(); assert.equal(await guard.canActivate(context), true);
  assert.equal(reads, 1); assert.equal((user as SessionUser)[SESSION_PERMISSION_BITS], 2n);
  assert.equal(Object.getOwnPropertyDescriptor(user!, SESSION_PERMISSION_BITS)?.enumerable, false);
  bits = 0n;
  await restore(); await assert.rejects(guard.canActivate(context), ForbiddenException);
  assert.equal(reads, 2);
});
