import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, Role, User } from "@kumo/domain";
import { RootLoginCase, RootLoginDisabled, RootLoginRejected, type UnitOfWork, type UnitOfWorkRepositories } from "../dist/index.js";
import { emptyRepositories } from "./support/repositories.ts";

test("root login seeds only root and Super, then preserves eligibility and revoked permissions", async (): Promise<void> => {
  let user: User | null = null;
  let role: Role | null = null;
  let assigned: string[] = [];
  const repositories: UnitOfWorkRepositories = {
    ...emptyRepositories(),
    users: { ...emptyRepositories().users,
      findByIdForUpdate: async (id: string): Promise<User | null> => { assert.equal(id, "root"); return user; },
      save: async (value: User): Promise<void> => { user = value; },
    },
    roles: { ...emptyRepositories().roles,
      findByIdForUpdate: async (id: string): Promise<Role | null> => { assert.equal(id, "super"); return role; },
      insert: async (value: Role): Promise<void> => { role = value; },
      findActiveByUserId: async (): Promise<Role[]> => role?.active && assigned.includes(role.id) ? [role] : [],
    },
    userRoles: { ...emptyRepositories().userRoles,
      replaceForUser: async (id: string, ids: readonly string[]): Promise<void> => { assert.equal(id, "root"); assigned = [...ids]; },
    },
  };
  const uow: UnitOfWork = { run: async <T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => work(repositories) };
  const login: RootLoginCase = new RootLoginCase(uow, { enabled: true, verify: async (password: string): Promise<boolean> => password === "correct" });
  await assert.rejects(login.exec("wrong"), RootLoginRejected);
  assert.equal(user, null);
  const root: User = await login.exec("correct");
  assert.equal(root.id, "root");
  assert.equal(root.displayName, "Root");
  assert.equal(root.stripeCustomerId, null);
  assert.deepEqual(assigned, ["super"]);
  assert.equal((role as Role | null)?.getPermissionBits(), 1n << BigInt(Permission.Super.offset));
  assert.strictEqual(await login.exec("correct"), root);
  assigned = [];
  await assert.rejects(login.exec("correct"), RootLoginRejected);
  assert.deepEqual(assigned, []);
  assigned = ["super"];
  user = new User({ id: "root", displayName: "Root", active: false, suspended: false });
  await assert.rejects(login.exec("correct"), RootLoginRejected);
  user = new User({ id: "root", displayName: "Root", suspended: true });
  await assert.rejects(login.exec("correct"), RootLoginRejected);
  user = null;
  role = new Role({ id: "super", name: "Disabled", active: false, permission: 1n });
  await assert.rejects(login.exec("correct"), RootLoginRejected);
  assert.equal(user, null);
  role = new Role({ id: "super", name: "Customized", permission: 0n });
  await assert.rejects(login.exec("correct"), RootLoginRejected);
  assert.equal(user, null);
});

test("unconfigured root login never verifies credentials or touches the database", async (): Promise<void> => {
  const login: RootLoginCase = new RootLoginCase({ run: async (): Promise<never> => { throw new Error("Unexpected database access"); } }, {
    enabled: false, verify: async (): Promise<never> => { throw new Error("Unexpected password verification"); },
  });
  await assert.rejects(login.exec("anything"), RootLoginDisabled);
});
