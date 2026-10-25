import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidDomainParams, Permission, Role, type PermissionDefinition } from "@kumo/domain";
import { CheckPermissionsCase } from "../dist/use-cases/role/CheckPermissions.case.js";

const READ: PermissionDefinition = Permission.DeploymentRead;
const WRITE: PermissionDefinition = { offset: 2, name: "Test write", description: "Test-only permission", requires: [] };

test("permissions from separate active roles are ORed and every required bit is checked", async (): Promise<void> => {
  let roles: Role[] = [new Role({ id: "reader", name: "Reader", permission: 2n }), new Role({ id: "writer", name: "Writer", permission: 4n })];
  const check: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (userId: string): Promise<Role[]> => {
    assert.equal(userId, "123");
    return roles;
  } });
  assert.equal(await check.exec("123", [READ, WRITE]), true);
  assert.equal(await check.exec("123", [READ, READ]), true);
  roles = [roles[0]!];
  assert.equal(await check.exec("123", [READ, WRITE]), false);
  roles = [];
  assert.equal(await check.exec("123", [READ]), false);
});

test("inactive roles cannot grant permissions or Super", async (): Promise<void> => {
  const check: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => [
    new Role({ id: "inactive", name: "Inactive Super", permission: 1n, active: false }),
    new Role({ id: "reader", name: "Reader", permission: 2n }),
  ] });
  assert.equal(await check.exec("123", [READ]), true);
  assert.equal(await check.exec("123", [READ, WRITE]), false);
});

test("active Super grants all valid requested bits; malformed offsets fail closed", async (): Promise<void> => {
  const check: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => [new Role({ id: "super", name: "Super", permission: 1n })] });
  assert.equal(await check.exec("123", [READ, WRITE]), true);
  assert.equal(await check.exec("123", [{ ...WRITE, offset: -1 }]), false);
  assert.equal(await check.exec("123", [{ ...WRITE, offset: 1.5 }]), false);
});

test("empty permission lists do not query roles, and repository failures do not grant access", async (): Promise<void> => {
  const failure: Error = new Error("Database unavailable");
  const check: CheckPermissionsCase = new CheckPermissionsCase({ findActiveByUserId: async (): Promise<never> => { throw failure; } });
  assert.equal(await check.exec("123", []), true);
  await assert.rejects(check.exec("123", [READ]), (error: unknown): boolean => error === failure);
});

test("roles default to active and validate explicit activity values", (): void => {
  assert.equal(new Role({ id: "role", name: "Role" }).active, true);
  assert.equal(new Role({ id: "role", name: "Role", active: false }).active, false);
  assert.throws((): Role => new Role({ id: "role", name: "Role", active: "true" as unknown as boolean }), InvalidDomainParams);
});
