import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoleManagementConflict,
  RoleManagementForbidden,
  RoleManagementNotFound,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "../dist/ports/index.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { GetUserRoleAssignmentsCase, type UserRoleAssignments } from "../dist/use-cases/role/GetUserRoleAssignments.case.js";
import { ManageRolesCase, type RoleWriteInput } from "../dist/use-cases/role/ManageRoles.case.js";
import { ReplaceUserRolesCase } from "../dist/use-cases/role/ReplaceUserRoles.case.js";
import { Permission, Role, User } from "@kumo/domain";
import { emptyRepositories } from "./support/repositories.ts";

const ROLE_MANAGE: bigint = 1n << BigInt(Permission.RoleManage.offset);
const PLAN_MANAGE: bigint = 1n << BigInt(Permission.PlanManage.offset);
const SUPER: bigint = 1n << BigInt(Permission.Super.offset);

class RoleFixture {
  public readonly roles: Map<string, Role> = new Map<string, Role>();
  public readonly users: Map<string, User> = new Map<string, User>();
  public readonly assignments: Map<string, string[]> = new Map<string, string[]>();

  public addRole(id: string, permission: bigint, active: boolean = true): Role {
    const role: Role = new Role({ id, name: id, permission, active });
    this.roles.set(id, role);
    return role;
  }

  public addUser(id: string): User {
    const user: User = new User({ id, displayName: id, suspended: false });
    this.users.set(id, user);
    return user;
  }

  public assign(userId: string, roleIds: readonly string[]): void {
    this.assignments.set(userId, [...roleIds]);
  }

  public unitOfWork(): UnitOfWork {
    const repositories: UnitOfWorkRepositories = {
      ...emptyRepositories(),
      users: this.userRepository(),
      roles: this.roleRepository(),
      userRoles: this.userRoleRepository(),
    };

    return {
      run<T>(work: (transactionRepositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
        return work(repositories);
      },
    };
  }

  private userRepository(): UserRepository {
    return {
      findById: async (id: string): Promise<User | null> => this.users.get(id) ?? null,
      findByIdForUpdate: async (id: string): Promise<User | null> => this.users.get(id) ?? null,
      exists: async (id: string): Promise<boolean> => this.users.has(id),
      save: async (user: User): Promise<void> => { this.users.set(user.id, user); },
    };
  }

  private roleRepository(): RoleRepository {
    const role = (id: string): Role | null => this.roles.get(id) ?? null;

    return {
      findById: async (id: string): Promise<Role | null> => role(id),
      findByIds: async (ids: readonly string[]): Promise<Role[]> => ids
        .map((id: string): Role | undefined => this.roles.get(id))
        .filter((value: Role | undefined): value is Role => value !== undefined)
        .sort((left: Role, right: Role): number => left.id.localeCompare(right.id)),
      findAll: async (): Promise<Role[]> => [...this.roles.values()],
      findActiveByUserId: async (userId: string): Promise<Role[]> => (this.assignments.get(userId) ?? [])
        .map((id: string): Role | undefined => this.roles.get(id))
        .filter((value: Role | undefined): value is Role => value !== undefined && value.active),
      save: async (next: Role): Promise<void> => { this.roles.set(next.id, next); },
      insert: async (next: Role): Promise<void> => {
        if (this.roles.has(next.id)) throw new RoleManagementConflict("A role with this ID already exists");
        this.roles.set(next.id, next);
      },
      replace: async (next: Role): Promise<void> => {
        if (!this.roles.has(next.id)) throw new RoleManagementNotFound("Role not found");
        this.roles.set(next.id, next);
      },
      deactivate: async (id: string): Promise<void> => {
        const existing: Role | null = role(id);
        if (!existing) throw new RoleManagementNotFound("Role not found");
        this.roles.set(id, new Role({
          id: existing.id,
          name: existing.name,
          permission: existing.getPermissionBits(),
          createdAt: existing.createdAt,
          active: false,
        }));
      },
    };
  }

  private userRoleRepository(): UserRoleRepository {
    return {
      findByUserId: async (userId: string): Promise<Role[]> => (this.assignments.get(userId) ?? [])
        .map((id: string): Role | undefined => this.roles.get(id))
        .filter((value: Role | undefined): value is Role => value !== undefined)
        .sort((left: Role, right: Role): number => left.id.localeCompare(right.id)),
      replaceForUser: async (userId: string, roleIds: readonly string[]): Promise<void> => {
        this.assignments.set(userId, [...roleIds]);
      },
    };
  }
}

function input(id: string, permission: bigint, active: boolean = true): RoleWriteInput {
  return { id, name: `Role ${id}`, permission, active };
}

test("role writes reject grants and removals that exceed the actor's own permissions", async (): Promise<void> => {
  const fixture: RoleFixture = new RoleFixture();
  fixture.addUser("manager");
  fixture.addUser("target");
  fixture.addRole("manager", ROLE_MANAGE);
  fixture.addRole("higher", PLAN_MANAGE);
  fixture.addRole("viewer", 0n);
  fixture.assign("manager", ["manager"]);
  fixture.assign("target", ["higher"]);
  const manage: ManageRolesCase = new ManageRolesCase(fixture.unitOfWork());
  const replaceAssignments: ReplaceUserRolesCase = new ReplaceUserRolesCase(fixture.unitOfWork());

  await assert.rejects(
    manage.create(input("new-admin", PLAN_MANAGE), "manager"),
    RoleManagementForbidden,
  );
  await assert.rejects(
    manage.replace(input("higher", PLAN_MANAGE), "manager"),
    RoleManagementForbidden,
  );
  await assert.rejects(
    replaceAssignments.exec({ actorId: "manager", userId: "target", roleIds: ["viewer"] }),
    RoleManagementForbidden,
  );
  await assert.rejects(
    replaceAssignments.exec({ actorId: "manager", userId: "manager", roleIds: ["viewer"] }),
    RoleManagementForbidden,
  );
});

test("role writes prevent an actor from removing their own role management access", async (): Promise<void> => {
  const fixture: RoleFixture = new RoleFixture();
  fixture.addUser("manager");
  fixture.addRole("manager", ROLE_MANAGE);
  fixture.assign("manager", ["manager"]);
  const manage: ManageRolesCase = new ManageRolesCase(fixture.unitOfWork());

  await assert.rejects(
    manage.replace({ ...input("manager", ROLE_MANAGE), active: false }, "manager"),
    RoleManagementForbidden,
  );
  await assert.rejects(
    manage.replace({ ...input("manager", 0n), active: true }, "manager"),
    RoleManagementForbidden,
  );
  await assert.rejects(
    manage.deactivate("manager", "manager"),
    RoleManagementForbidden,
  );
});

test("role writes preserve unknown stored permission bits while replacing known grants", async (): Promise<void> => {
  const fixture: RoleFixture = new RoleFixture();
  fixture.addUser("admin");
  fixture.addRole("admin", SUPER | ROLE_MANAGE);
  fixture.addRole("legacy", ROLE_MANAGE | (1n << 40n));
  fixture.assign("admin", ["admin"]);
  const manage: ManageRolesCase = new ManageRolesCase(fixture.unitOfWork());

  const updated: Role = await manage.replace(input("legacy", ROLE_MANAGE), "admin");

  assert.equal(updated.name, "Role legacy");
  assert.equal((updated.getPermissionBits() & (1n << 40n)) === (1n << 40n), true);
  assert.equal((updated.getPermissionBits() & ROLE_MANAGE) === ROLE_MANAGE, true);
});

test("role assignment replaces exact active assignments and rejects unknown or inactive roles", async (): Promise<void> => {
  const fixture: RoleFixture = new RoleFixture();
  fixture.addUser("admin");
  fixture.addUser("target");
  fixture.addRole("admin", SUPER | ROLE_MANAGE);
  fixture.addRole("viewer", 0n);
  fixture.addRole("inactive", 0n, false);
  fixture.assign("admin", ["admin"]);
  const replaceAssignments: ReplaceUserRolesCase = new ReplaceUserRolesCase(fixture.unitOfWork());
  const getAssignments: GetUserRoleAssignmentsCase = new GetUserRoleAssignmentsCase(fixture.unitOfWork());

  const updated: UserRoleAssignments = await replaceAssignments.exec({
    actorId: "admin",
    userId: "target",
    roleIds: ["viewer"],
  });
  assert.deepEqual(updated.roles.map((role: Role): string => role.id), ["viewer"]);
  assert.deepEqual(fixture.assignments.get("target"), ["viewer"]);

  const read: UserRoleAssignments = await getAssignments.exec("target");
  assert.equal(read.user.id, "target");
  assert.deepEqual(read.roles.map((role: Role): string => role.id), ["viewer"]);

  await assert.rejects(
    replaceAssignments.exec({ actorId: "admin", userId: "target", roleIds: ["missing"] }),
    RoleManagementNotFound,
  );
  await assert.rejects(
    replaceAssignments.exec({ actorId: "admin", userId: "target", roleIds: ["inactive"] }),
    RoleManagementConflict,
  );
  await assert.rejects(
    replaceAssignments.exec({ actorId: "admin", userId: "missing", roleIds: [] }),
    RoleManagementNotFound,
  );
});
