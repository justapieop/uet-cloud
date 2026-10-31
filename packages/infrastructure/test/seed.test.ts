import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, type PlanDetails, type Role } from "@kumo/domain";
import { defaultSeedRoles, parseDatabaseSeedInput, seedDatabase, type DatabaseSeedInput } from "../dist/db/seed.js";
import type { DataSource } from "typeorm";
import { addGithubAdmin, AdminBootstrapError, validateGithubUserId } from "../dist/db/add-admin.js";

const PLAN: PlanDetails = { id: "example", name: "Example", price: 5, vcpu: 0.5, memory: 1, deployments: 1, disk: 64, active: false };

test("admin bootstrap accepts only canonical numeric GitHub IDs before touching the database", async (): Promise<void> => {
  validateGithubUserId("12345678901234567890");
  const source: DataSource = { transaction: (): never => { throw new Error("Must not reach database"); } } as unknown as DataSource;
  for (const id of ["", "octocat", "0", "0123", "-1", "1.5", "123 ", "1e3", "1".repeat(256), "123' OR 1=1"]) {
    assert.throws((): void => { validateGithubUserId(id); }, AdminBootstrapError);
    await assert.rejects(addGithubAdmin(source, id), AdminBootstrapError);
  }
});

test("seed roles grant the intended resource actions without assigning Super to ordinary users", (): void => {
  const roles: Role[] = defaultSeedRoles();
  assert.deepEqual(roles.map((role: Role): string => role.id), ["viewer", "developer", "admin"]);
  assert.deepEqual(roles[0]!.getGrantedPermissions(), [Permission.DeploymentRead, Permission.BuildRead, Permission.DeploymentMetricsRead]);
  assert.equal(roles[0]!.hasPermission(Permission.DeploymentCreate), false);
  assert.equal(roles[1]!.hasPermission(Permission.DeploymentCreate), true);
  assert.equal(roles[1]!.hasPermission(Permission.DeploymentUpdate), true);
  assert.equal(roles[1]!.hasPermission(Permission.DeploymentDelete), true);
  assert.equal(roles[1]!.hasPermission(Permission.Super), false);
  assert.equal(roles[2]!.getPermissionBits(), 1n);
  assert.deepEqual(parseDatabaseSeedInput({}), { plans: [], assignments: [] });
});

test("seed input normalizes plan defaults and validates storage limits before database writes", async (): Promise<void> => {
  const parsed: DatabaseSeedInput = parseDatabaseSeedInput({ plans: [PLAN], assignments: [{ userId: "123", roleId: "developer" }] });
  assert.equal(parsed.plans![0]!.stripeProductId, null);
  assert.equal(parsed.plans![0]!.maxReplicas, 1);
  assert.equal(parsed.plans![0]!.active, false);
  assert.deepEqual(parseDatabaseSeedInput(parsed), parsed);
  for (const input of [null, { extra: true }, { plans: {} }, { assignments: [{ userId: "123", roleId: ["admin"] }] },
    { plans: [{ ...PLAN, memory: 2 }] }, { plans: [{ ...PLAN, price: 0.00001 }] },
    { plans: [{ ...PLAN, deployments: 2147483648 }] }, { plans: [PLAN, { ...PLAN, id: "EXAMPLE" }] },
    { plans: [{ ...PLAN, stripeProductId: "prod_same" }, { ...PLAN, id: "other", stripeProductId: "prod_same" }] },
  ]) assert.throws((): void => { parseDatabaseSeedInput(input); });
  let transactions: number = 0;
  const source: DataSource = { transaction: (): never => { transactions++; throw new Error("Must not reach database"); } } as unknown as DataSource;
  await assert.rejects(seedDatabase(source, { plans: [{ ...PLAN, memory: 2 }] }));
  assert.equal(transactions, 0);
});
