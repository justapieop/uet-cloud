import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidDomainParams, Permission, Role, User } from "../dist/index.js";

function createUser(id: string, displayName: string): User {
  return new User({ id, displayName, suspended: false });
}

test("valid user construction and revalidation are repeatable", (): void => {
  for (let attempt: number = 0; attempt < 3; attempt++) {
    const user: User = createUser("user-1", "Alice");
    assert.equal(user.validate(), null);
    assert.equal(user.validate(), null);
  }
});

test("user construction rejects blank identity fields", (): void => {
  const invalidUsers: readonly { id: string; displayName: string }[] = [
    { id: "", displayName: "Alice" },
    { id: "user-1", displayName: "" },
    { id: "  ", displayName: "Alice" },
    { id: "user-1", displayName: "  " },
  ];

  invalidUsers.forEach((details: { id: string; displayName: string }): void => {
    assert.throws((): User => createUser(details.id, details.displayName), InvalidDomainParams);
  });
});

test("user preserves identity and display name", (): void => {
  const user: User = createUser("user-1", "Alice");
  assert.equal(user.id, "user-1");
  assert.equal(user.displayName, "Alice");
});

test("Super grants copied permissions and permissions outside the catalog", (): void => {
  const role: Role = new Role({ id: "admin", name: "Admin", permission: 1n });
  const requested: Permission = { offset: 10, name: "Example", description: "Example permission" };

  assert.equal(role.hasPermission({ ...Permission.Super }), true);
  assert.equal(role.hasPermission(requested), true);
  assert.deepEqual(role.getGrantedPermissions(), Object.values(Permission));
});

test("ordinary roles check the offset independently of metadata", (): void => {
  const role: Role = new Role({ id: "role-1", name: "Role", permission: 1n << 10n });
  const requested: Permission = { offset: 10, name: "Example", description: "Example permission" };

  assert.equal(role.hasPermission(requested), true);
  assert.equal(role.hasPermission({ ...requested, name: "Renamed", description: "Changed" }), true);
  assert.equal(role.hasPermission({ ...requested, offset: 11 }), false);
  assert.equal(role.hasPermission(Permission.Super), false);
  assert.deepEqual(role.getGrantedPermissions(), []);
});

test("roles without bits grant no permissions", (): void => {
  const role: Role = new Role({ id: "empty", name: "Empty" });
  assert.equal(role.hasPermission({ ...Permission.Super }), false);
  assert.deepEqual(role.getGrantedPermissions(), []);
});

test("invalid offsets do not cause shifts or grant access", (): void => {
  const role: Role = new Role({ id: "admin", name: "Admin", permission: 1n });
  const invalidOffsets: readonly number[] = [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];

  invalidOffsets.forEach((offset: number): void => {
    assert.equal(role.hasPermission({ ...Permission.Super, offset }), false);
  });
});
