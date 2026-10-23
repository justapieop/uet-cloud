import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, Role, type PermissionDefinition } from "@kumo/domain";
import { GetRoleCatalogCase, type RoleCatalog } from "../dist/use-cases/role/GetRoleCatalog.case.js";

test("role catalog reads every role and returns the permission catalog in stable offset order", async (): Promise<void> => {
  const roles: Role[] = [
    new Role({ id: "admin", name: "Administrator", permission: 1n }),
    new Role({ id: "viewer", name: "Viewer", permission: (1n << 1n) | (1n << 5n), active: false }),
  ];
  let reads: number = 0;
  const catalog: GetRoleCatalogCase = new GetRoleCatalogCase({
    findAll: async (): Promise<Role[]> => {
      reads += 1;
      return roles;
    },
  });

  const result: RoleCatalog = await catalog.exec();

  assert.equal(reads, 1);
  assert.deepEqual(result.roles, roles);
  assert.deepEqual(result.permissions, Object.values(Permission));
  assert.equal(result.permissions.at(-1), Permission.RoleManage);
  assert.deepEqual(
    result.permissions.map((permission: PermissionDefinition): number => permission.offset),
    result.permissions.map((_permission: PermissionDefinition, index: number): number => index),
  );
});
