import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, Role, type PermissionDefinition } from "../dist/index.js";

test("permission catalog preserves persisted offsets and fits SQL Server role bitsets", (): void => {
  const offsets: Record<keyof typeof Permission, number> = {
    Super: 0,
    DeploymentRead: 1,
    DeploymentCreate: 2,
    DeploymentUpdate: 3,
    DeploymentDelete: 4,
    BuildRead: 5,
    DeploymentMetricsRead: 6,
  };
  const definitions: PermissionDefinition[] = Object.values(Permission);
  assert.equal(new Set(definitions.map((definition: PermissionDefinition): number => definition.offset)).size, definitions.length);
  for (const key of Object.keys(offsets) as (keyof typeof Permission)[]) {
    const definition: PermissionDefinition = Permission[key];
    assert.equal(definition.offset, offsets[key]);
    assert.ok(Number.isSafeInteger(definition.offset) && definition.offset >= 0 && definition.offset <= 62);
    assert.ok(definition.name.trim().length > 0 && definition.description.trim().length > 0);
    for (const prerequisite of definition.requires) {
      assert.ok(definitions.includes(prerequisite));
      assert.notEqual(prerequisite.offset, definition.offset);
    }
  }
});

test("catalog grants stay independent and prerequisite metadata does not grant extra bits", (): void => {
  const definitions: PermissionDefinition[] = Object.values(Permission).filter(
    (definition: PermissionDefinition): boolean => definition !== Permission.Super,
  );
  for (const definition of definitions) {
    const role: Role = new Role({ id: "single-grant", name: definition.name, permission: 1n << BigInt(definition.offset) });
    assert.deepEqual(role.getGrantedPermissions(), [definition]);
    for (const prerequisite of definition.requires) assert.equal(role.hasPermission(prerequisite), false);
  }
  const bits: bigint = definitions.reduce(
    (grants: bigint, definition: PermissionDefinition): bigint => grants | (1n << BigInt(definition.offset)), 0n,
  );
  const role: Role = new Role({ id: "all-actions", name: "All resource actions", permission: bits });
  assert.deepEqual(role.getGrantedPermissions(), definitions);
  assert.equal(role.hasPermission(Permission.Super), false);
});
