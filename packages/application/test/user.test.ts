import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, Role, User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { CreateUserCase } from "../dist/use-cases/user/CreateUser.case.js";
import { emptyRepositories } from "./support/repositories.ts";

class SignupFixture implements UnitOfWork {
  public users: Map<string, User> = new Map();
  public roles: Map<string, Role> = new Map();
  public assignments: Map<string, readonly string[]> = new Map();
  public failAssignment: boolean = false;
  public linkCalls: number = 0;
  private inTransaction: boolean = false;
  public readonly useCase: CreateUserCase = new CreateUserCase(this, {
    exec: async (id: string): Promise<User> => {
      assert.equal(this.inTransaction, false);
      assert.deepEqual(this.assignments.get(id), ["default"]);
      this.linkCalls++;
      return this.users.get(id)!;
    },
  });

  public async run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    const users: Map<string, User> = new Map(this.users);
    const roles: Map<string, Role> = new Map(this.roles);
    const assignments: Map<string, readonly string[]> = new Map(this.assignments);
    this.inTransaction = true;
    try {
      return await work({
        ...emptyRepositories(),
        users: {
          ...emptyRepositories().users,
          findByIdForUpdate: async (id: string): Promise<User | null> => this.users.get(id) ?? null,
          save: async (user: User): Promise<void> => { this.users.set(user.id, user); },
        },
        roles: {
          ...emptyRepositories().roles,
          findByIdForUpdate: async (id: string): Promise<Role | null> => {
            assert.ok(id === "default" || id === "super");
            return this.roles.get(id) ?? null;
          },
          insert: async (role: Role): Promise<void> => {
            assert.ok(!this.roles.has(role.id));
            this.roles.set(role.id, role);
          },
        },
        userRoles: {
          ...emptyRepositories().userRoles,
          replaceForUser: async (id: string, ids: readonly string[]): Promise<void> => {
            if (this.failAssignment) throw new Error("Assignment failed");
            this.assignments.set(id, [...ids]);
          },
        },
      });
    } catch (error: unknown) {
      this.users = users;
      this.roles = roles;
      this.assignments = assignments;
      throw error;
    } finally { this.inTransaction = false; }
  }
}

test("new user self-seeds the default role with explicit workload grants and assigns it before linking Stripe", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  const user: User = await fixture.useCase.exec("123", "Alice");
  const role: Role = fixture.roles.get("default")!;
  assert.equal(user.id, "123");
  assert.equal(role.name, "Default");
  assert.equal(role.active, true);
  assert.deepEqual(role.getStoredPermissions().map((permission: Permission): number => permission.offset).sort((a: number, b: number): number => a - b),
    [Permission.DeploymentRead, Permission.BuildRead, Permission.DeploymentMetricsRead, Permission.DeploymentCreate, Permission.DeploymentUpdate, Permission.DeploymentDelete]
      .map((permission: Permission): number => permission.offset).sort((a: number, b: number): number => a - b));
  assert.equal(role.hasPermission(Permission.Super), false);
  const superRole: Role = fixture.roles.get("super")!;
  assert.equal(superRole.name, "Super");
  assert.equal(superRole.active, true);
  assert.equal(superRole.getPermissionBits(), 1n << BigInt(Permission.Super.offset));
  assert.deepEqual(fixture.assignments.get(user.id), ["default"]);
  assert.equal(fixture.linkCalls, 1);
});

test("new users reuse a customized default role without changing its grants or name", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  const custom: Role = new Role({ id: "default", name: "Custom default", permission: 1n << BigInt(Permission.DeploymentRead.offset) });
  fixture.roles.set(custom.id, custom);
  await fixture.useCase.exec("123", "Alice");
  await fixture.useCase.exec("456", "Bob");
  assert.strictEqual(fixture.roles.get("default"), custom);
  assert.equal(fixture.roles.size, 2);
  assert.deepEqual(fixture.assignments.get("456"), ["default"]);
});

test("signup preserves customized or inactive Super roles without assigning them", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  const existing: Role = new Role({ id: "super", name: "Disabled Super", permission: 0n, active: false });
  fixture.roles.set(existing.id, existing);
  await fixture.useCase.exec("123", "Alice");
  assert.strictEqual(fixture.roles.get("super"), existing);
  assert.deepEqual(fixture.assignments.get("123"), ["default"]);
});

test("repeat login preserves existing users and revoked assignments without recreating a missing default role", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  const existing: User = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_existing" });
  fixture.users.set(existing.id, existing);
  fixture.assignments.set(existing.id, []);
  assert.strictEqual(await fixture.useCase.exec("123", "Ignored"), existing);
  assert.equal(fixture.roles.size, 0);
  assert.deepEqual(fixture.assignments.get("123"), []);
  assert.equal(fixture.linkCalls, 0);
});

test("an inactive default role blocks new registration without reactivating it", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  const disabled: Role = new Role({ id: "default", name: "Disabled", active: false });
  fixture.roles.set(disabled.id, disabled);
  await assert.rejects(fixture.useCase.exec("123", "Alice"), /Default role is inactive/);
  assert.equal(fixture.users.size, 0);
  assert.strictEqual(fixture.roles.get("default"), disabled);
  assert.equal(fixture.linkCalls, 0);
});

test("failed role assignment rolls back user and self-seeded role and never calls Stripe", async (): Promise<void> => {
  const fixture: SignupFixture = new SignupFixture();
  fixture.failAssignment = true;
  await assert.rejects(fixture.useCase.exec("123", "Alice"), /Assignment failed/);
  assert.equal(fixture.users.size, 0);
  assert.equal(fixture.roles.size, 0);
  assert.equal(fixture.assignments.size, 0);
  assert.equal(fixture.linkCalls, 0);
});
