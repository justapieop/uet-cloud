import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { DataSource, type DataSourceOptions, type Repository } from "typeorm";
import { idempotencyStoreContract, type IdempotencyStoreContractCase } from "@nestjs/idempotency/testing";
import { CreateDeploymentCase, DeploymentAlreadyExists, DeploymentQuotaExceeded, type UnitOfWork, type UnitOfWorkRepositories } from "@kumo/application";
import { Build, Deployment, Role, User, type DeploymentSpec } from "@kumo/domain";
import { InfraSessionAuthorizationReader } from "../dist/auth/session-authorization.js";
import { InfraBuild, InfraBuildRepository } from "../dist/db/repositories/build.js";
import { DATABASE_MIGRATIONS, InfraDeployment, InfraDeploymentRepository, InfraPlan, InfraRole, InfraRoleRepository, InfraUser, InfraUserRepository, InfraUserRole, SqlServerIdempotencyStore, TypeOrmUnitOfWork, addGithubAdmin, seedDatabase, type DatabaseSeedInput } from "../dist/db/index.js";

const ENABLED: boolean = process.env.RUN_SQLSERVER_TESTS === "true";
const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", tag: "v1", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 };

test("SQL Server migrations, constraints, acceptance transactions and worker claims", { skip: !ENABLED, timeout: 180_000 }, async (context: TestContext): Promise<void> => {
  const password: string | undefined = process.env.TEST_SQLSERVER_PASSWORD;
  assert.ok(password, "TEST_SQLSERVER_PASSWORD is required; application database settings are never used");
  const database: string = `kumo_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(database, /^kumo_test_[a-f0-9]{32}$/);
  const options: DataSourceOptions = {
    type: "mssql", host: process.env.TEST_SQLSERVER_HOST ?? "127.0.0.1", port: Number(process.env.TEST_SQLSERVER_PORT ?? "1433"),
    username: process.env.TEST_SQLSERVER_USER ?? "sa", password,
    options: { encrypt: false, trustServerCertificate: true }, pool: { max: 20 }, logging: false,
  };
  const admin: DataSource = new DataSource({ ...options, database: "master" });
  const source: DataSource = new DataSource({ ...options, database, entities: [InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraPlan, InfraBuild], migrations: DATABASE_MIGRATIONS, synchronize: false });
  let created: boolean = false;
  context.after(async (): Promise<void> => {
    try {
      if (source.isInitialized) await source.destroy();
      if (created) {
        await admin.query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
        await admin.query(`DROP DATABASE [${database}]`);
      }
    } finally { if (admin.isInitialized) await admin.destroy(); }
  });
  await admin.initialize();
  await admin.query(`CREATE DATABASE [${database}]`);
  created = true;
  await admin.query(`ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON`);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  assert.equal(await source.showMigrations(), false);
  await source.getRepository(InfraUser).save([
    { id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" },
    { id: "456", displayName: "Bob", suspended: false, stripeCustomerId: "cus_bob" },
  ]);
  await source.getRepository(InfraPlan).save({ id: "starter", name: "Starter", price: 5, vcpu: 0.5, memory: 1, deployments: 1, disk: 10, active: true, maxReplicas: 2, stripeProductId: "prod_starter" });
  const uow: TypeOrmUnitOfWork = new TypeOrmUnitOfWork(source);
  const admission: CreateDeploymentCase = new CreateDeploymentCase(uow, { getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_starter"] });
  const repository: InfraDeploymentRepository = new InfraDeploymentRepository(source.getRepository(InfraDeployment));
  let accepted: Deployment;

  await context.test("two connections racing for the last deployment slot cannot exceed the quota", async (): Promise<void> => {
    const results: PromiseSettledResult<Deployment>[] = await Promise.allSettled([
      admission.exec({ userId: "123", name: "first-app", spec: SPEC, idempotencyKey: "first" }),
      admission.exec({ userId: "123", name: "second-app", spec: SPEC, idempotencyKey: "second" }),
    ]);
    const winner: PromiseSettledResult<Deployment> | undefined = results.find((result: PromiseSettledResult<Deployment>): boolean => result.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");
    accepted = winner.value;
    assert.equal(results.filter((result: PromiseSettledResult<Deployment>): boolean => result.status === "fulfilled").length, 1);
    assert.ok(results.some((result: PromiseSettledResult<Deployment>): boolean => result.status === "rejected" && result.reason instanceof DeploymentQuotaExceeded));
    assert.equal(await source.getRepository(InfraDeployment).countBy({ userId: "123" }), 1);
    const receipts: { count: number }[] = await source.query("SELECT COUNT(*) AS count FROM deployment_request_receipts");
    assert.equal(receipts[0]!.count, 1);
  });
  assert.ok(accepted!, "Acceptance race must produce a deployment");

  await context.test("user active defaults to true and persists explicit false", async (): Promise<void> => {
    const users: InfraUserRepository = new InfraUserRepository(source.getRepository(InfraUser));
    const user: User | null = await users.findById("123");
    assert.ok(user);
    assert.equal(user.active, true);
    await users.save(new User({ ...user, active: false }));
    assert.equal((await users.findById("123"))?.active, false);
  });

  await context.test("user-role links enforce foreign keys, unique pairs and cascading parent deletion", async (): Promise<void> => {
    const links: Repository<InfraUserRole> = source.getRepository(InfraUserRole);
    await source.getRepository(InfraRole).save([
      { id: "reader", name: "Reader", permission: 0n },
      { id: "writer", name: "Writer", permission: 0n },
    ]);
    await links.insert([
      { userId: "123", roleId: "reader" }, { userId: "123", roleId: "writer" }, { userId: "456", roleId: "reader" },
    ]);
    assert.equal(await links.countBy({ userId: "123" }), 2);
    assert.equal(await links.countBy({ roleId: "reader" }), 2);
    const roles: InfraRoleRepository = new InfraRoleRepository(source.getRepository(InfraRole));
    await roles.save(new Role({ id: "inactive", name: "Inactive Super", permission: 1n, active: false }));
    await roles.save(new Role({ id: "other-user", name: "Other user's role", permission: 4n }));
    await links.insert([{ userId: "123", roleId: "inactive" }, { userId: "456", roleId: "other-user" }]);
    assert.equal((await roles.findById("inactive"))?.active, false);
    assert.deepEqual((await roles.findActiveByUserId("123")).map((role: Role): string => role.id), ["reader", "writer"]);
    await source.getRepository(InfraRole).delete(["inactive", "other-user"]);
    await assert.rejects(links.insert({ userId: "123", roleId: "reader" }));
    await assert.rejects(links.insert({ userId: "missing", roleId: "reader" }));
    await assert.rejects(links.insert({ userId: "123", roleId: "missing" }));
    await source.getRepository(InfraRole).delete({ id: "writer" });
    assert.equal(await links.countBy({ roleId: "writer" }), 0);
    await source.getRepository(InfraUser).save({ id: "789", displayName: "Temporary user", suspended: false });
    await links.insert({ userId: "789", roleId: "reader" });
    await source.getRepository(InfraUser).delete({ id: "789" });
    assert.equal(await links.countBy({ userId: "789" }), 0);
    assert.equal(await links.count(), 2);
  });

  await context.test("the database enforces global names and unique plan product mappings", async (): Promise<void> => {
    await assert.rejects(repository.save(new Deployment({ id: randomUUID(), userId: "456", name: accepted.name, spec: SPEC })), DeploymentAlreadyExists);
    await assert.rejects(source.getRepository(InfraPlan).save({ id: "duplicate", name: "Duplicate", price: 5, vcpu: 0.5, memory: 1, deployments: 1, disk: 10, stripeProductId: "prod_starter" }));
    await assert.rejects(source.getRepository(InfraPlan).update({ id: "starter" }, { maxReplicas: 0 }));
  });

  await context.test("a receipt write failure rolls back both the deployment and receipt", async (): Promise<void> => {
    const failing: UnitOfWork = { run: <T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => uow.run(async (repos: UnitOfWorkRepositories): Promise<T> => {
      const save: UnitOfWorkRepositories["deploymentRequests"]["save"] = repos.deploymentRequests.save.bind(repos.deploymentRequests);
      repos.deploymentRequests.save = async (...args: Parameters<typeof save>): Promise<void> => { await save(...args); throw new Error("Receipt failure"); };
      return work(repos);
    }) };
    await assert.rejects(new CreateDeploymentCase(failing, { getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_starter"] })
      .exec({ userId: "456", name: "rollback-app", spec: SPEC, idempotencyKey: "rollback" }), /Receipt failure/);
    assert.equal(await source.getRepository(InfraDeployment).countBy({ userId: "456" }), 0);
    const receipts: { count: number }[] = await source.query("SELECT COUNT(*) AS count FROM deployment_request_receipts");
    assert.equal(receipts[0]!.count, 1);
  });

  await context.test("conditional worker claims return a request to at most one worker and expire stale work", async (): Promise<void> => {
    const claims: (Deployment | null)[] = await Promise.all([repository.claimNextPending(), repository.claimNextPending()]);
    assert.equal(claims.filter((deployment: Deployment | null): boolean => deployment !== null).length, 1);
    await source.getRepository(InfraDeployment).update({ id: accepted.id }, { updatedAt: new Date("2000-01-01") });
    await repository.failStaleProvisioning(new Date("2001-01-01"));
    assert.equal((await repository.findById(accepted.id))?.status, "FAILED");
  });

  await context.test("atomic queue claims return distinct deployments/builds and targeted updates retain creation inputs", async (): Promise<void> => {
    const ids: string[] = [randomUUID(), randomUUID()];
    for (let index: number = 0; index < ids.length; index++) {
      await repository.insert(new Deployment({ id: ids[index]!, userId: "456", name: `claim-app-${index}`, status: "PENDING", spec: SPEC }));
    }
    assert.equal(await repository.countReservedByUserId("456"), 2);
    const claims: (Deployment | null)[] = await Promise.all([repository.claimNextPending(), repository.claimNextPending()]);
    assert.equal(new Set(claims.map((item: Deployment | null): string | undefined => item?.id)).size, 2);
    assert.ok(claims.every((item: Deployment | null): boolean => item?.status === "PROVISIONING" && item.spec?.repo === SPEC.repo));
    const claimed: Deployment = claims[0]!;
    await repository.updateProgress(new Deployment({ ...claimed.getDetails(), spec: null, status: "FAILED", error: "test failure" }));
    assert.equal((await repository.findById(claimed.id))?.spec?.repo, SPEC.repo);
    assert.equal(await repository.countReservedByUserId("456"), 1);
    const builds: InfraBuildRepository = new InfraBuildRepository(source.getRepository(InfraBuild));
    for (let index: number = 0; index < ids.length; index++) {
      await builds.insert(new Build({ id: ids[index]!, userId: "456", repo: SPEC.repo, image: "registry/app:v1", status: "PENDING",
        commitSha: null, ref: null, error: null, dockerFilePath: "Dockerfile", sourceTokenHash: "a".repeat(64),
        sourceExpiresAt: new Date("2030-01-01"), runId: null, runUrl: null, createdAt: new Date(), updatedAt: new Date(),
      }));
    }
    const buildClaims: (Build | null)[] = await Promise.all([builds.claimNextPending(), builds.claimNextPending()]);
    assert.equal(new Set(buildClaims.map((item: Build | null): string | undefined => item?.getDetails().id)).size, 2);
    assert.ok(buildClaims.every((item: Build | null): boolean => item?.getDetails().status === "PREPARING"));
    await source.getRepository(InfraBuild).update({ id: ids[0]! }, { status: "SUCCEEDED", runId: "42", commitSha: "a".repeat(40) });
    await builds.updateRun(ids[0]!, "456", "PREPARING", { runId: "42", runUrl: "https://example.com/42", status: "RUNNING" });
    assert.equal((await builds.findById(ids[0]!))?.getDetails().status, "SUCCEEDED");
    await source.getRepository(InfraBuild).delete(ids);
    await source.getRepository(InfraDeployment).delete(ids);
  });

  await context.test("one authorization query returns fresh user/role changes without a session grant cache", async (): Promise<void> => {
    const reader: InfraSessionAuthorizationReader = new InfraSessionAuthorizationReader(source);
    await source.getRepository(InfraRole).insert({ id: "session-role", name: "Session role", permission: 4n, active: true });
    await source.getRepository(InfraUserRole).insert({ userId: "456", roleId: "session-role" });
    const authorized: Awaited<ReturnType<InfraSessionAuthorizationReader["read"]>> = await reader.read("456");
    assert.equal(authorized?.user.id, "456");
    assert.equal(authorized?.permissionBits, 4n);
    assert.equal(await reader.read("missing"), null);
    await source.getRepository(InfraRole).update({ id: "session-role" }, { active: false });
    assert.equal((await reader.read("456"))?.permissionBits, 0n);
    await source.getRepository(InfraRole).delete({ id: "session-role" });
  });

  await context.test("seeding preserves customized rows, serializes reruns, and rolls back invalid assignments", async (): Promise<void> => {
    const input: DatabaseSeedInput = {
      plans: [{ id: "seed-plan", name: "Seed plan", price: 5, vcpu: 0.5, memory: 1, deployments: 1, disk: 10, active: false }],
      assignments: [{ userId: "456", roleId: "developer" }],
    };
    assert.deepEqual(await seedDatabase(source, input), { rolesCreated: 3, plansCreated: 1, assignmentsCreated: 1, adminSuperAdded: false });
    await source.getRepository(InfraRole).update({ id: "admin" }, { permission: 4n, active: false });
    assert.equal((await seedDatabase(source, input)).adminSuperAdded, true);
    const repairedAdmin: InfraRole = await source.getRepository(InfraRole).findOneByOrFail({ id: "admin" });
    assert.equal(repairedAdmin.permission, 5n);
    assert.equal(repairedAdmin.active, false);
    await source.getRepository(InfraRole).update({ id: "developer" }, { name: "Customized", active: false, permission: 2n });
    await source.getRepository(InfraPlan).update({ id: "seed-plan" }, { price: 9 });
    const results: Awaited<ReturnType<typeof seedDatabase>>[] = await Promise.all([seedDatabase(source, input), seedDatabase(source, input)]);
    for (const result of results) assert.deepEqual(result, { rolesCreated: 0, plansCreated: 0, assignmentsCreated: 0, adminSuperAdded: false });
    assert.equal((await source.getRepository(InfraRole).findOneByOrFail({ id: "developer" })).active, false);
    assert.equal((await source.getRepository(InfraRole).findOneByOrFail({ id: "developer" })).permission, 2n);
    assert.equal((await source.getRepository(InfraPlan).findOneByOrFail({ id: "seed-plan" })).price, 9);
    assert.equal(await source.getRepository(InfraUserRole).countBy({ roleId: "admin" }), 0);
    await assert.rejects(seedDatabase(source, { plans: [{ ...input.plans![0]!, id: "rolled-back-plan" }], assignments: [{ userId: "missing", roleId: "admin" }] }));
    assert.equal(await source.getRepository(InfraPlan).countBy({ id: "rolled-back-plan" }), 0);
    await source.getRepository(InfraPlan).delete({ id: "seed-plan" });
    await source.getRepository(InfraRole).delete(["viewer", "developer", "admin"]);
  });

  await context.test("admin bootstrap creates or promotes GitHub users atomically and rejects disabled identities", async (): Promise<void> => {
    assert.deepEqual(await addGithubAdmin(source, "99901"), { userCreated: true, roleCreated: true, assignmentCreated: true });
    const users: Repository<InfraUser> = source.getRepository(InfraUser);
    const roles: Repository<InfraRole> = source.getRepository(InfraRole);
    const links: Repository<InfraUserRole> = source.getRepository(InfraUserRole);
    assert.equal((await users.findOneByOrFail({ id: "99901" })).stripeCustomerId, null);
    assert.equal((await users.findOneByOrFail({ id: "99901" })).displayName, "99901");
    await users.update({ id: "99901" }, { displayName: "Existing admin", stripeCustomerId: "cus_admin" });
    await roles.update({ id: "admin" }, { permission: 4n });
    assert.deepEqual(await addGithubAdmin(source, "99901"), { userCreated: false, roleCreated: false, assignmentCreated: false });
    assert.equal((await roles.findOneByOrFail({ id: "admin" })).permission, 5n);
    assert.equal((await users.findOneByOrFail({ id: "99901" })).stripeCustomerId, "cus_admin");
    assert.equal((await users.findOneByOrFail({ id: "99901" })).displayName, "Existing admin");
    const concurrent: Awaited<ReturnType<typeof addGithubAdmin>>[] = await Promise.all([addGithubAdmin(source, "99902"), addGithubAdmin(source, "99902")]);
    assert.equal(concurrent.filter((result): boolean => result.userCreated).length, 1);
    assert.equal(await links.countBy({ userId: "99902", roleId: "admin" }), 1);
    await roles.update({ id: "admin" }, { active: false });
    await assert.rejects(addGithubAdmin(source, "99903"), /admin role is disabled/);
    assert.equal(await users.countBy({ id: "99903" }), 0);
    await roles.update({ id: "admin" }, { active: true });
    await users.update({ id: "99902" }, { active: false });
    await assert.rejects(addGithubAdmin(source, "99902"), /inactive or suspended/);
    await users.update({ id: "99901" }, { suspended: true });
    await assert.rejects(addGithubAdmin(source, "99901"), /inactive or suspended/);
    await users.delete(["99901", "99902"]);
    await roles.delete({ id: "admin" });
  });

  const contract: IdempotencyStoreContractCase[] = idempotencyStoreContract((): SqlServerIdempotencyStore => new SqlServerIdempotencyStore(source), { concurrent: true });
  for (let index: number = 0; index < contract.length; index += 1) {
    const item: IdempotencyStoreContractCase = contract[index]!;
    await context.test(`SQL idempotency: ${item.name}`, item.run);
  }

  await context.test("the plan migration rolls back and reapplies without editing historical migrations", async (): Promise<void> => {
    const planIndex: number = DATABASE_MIGRATIONS.findIndex((migration): boolean => migration.name === "PlanStripeProduct1792540800001");
    assert.ok(planIndex >= 0);
    // Rewind later migrations too so appending another migration cannot silently change this test's target.
    for (let index: number = DATABASE_MIGRATIONS.length - 1; index >= planIndex; index -= 1) {
      await source.undoLastMigration({ transaction: "all" });
    }
    const runner: ReturnType<DataSource["createQueryRunner"]> = source.createQueryRunner();
    try {
      assert.equal(await runner.hasColumn("plans", "stripe_product_id"), false);
      assert.equal(await runner.hasColumn("plans", "max_replicas"), false);
      assert.equal(await runner.hasTable("user_roles"), false);
      assert.equal(await runner.hasColumn("users", "active"), false);
      assert.equal(await runner.hasColumn("roles", "active"), false);
      await source.runMigrations({ transaction: "all" });
      assert.equal(await runner.hasColumn("plans", "stripe_product_id"), true);
      assert.equal(await runner.hasColumn("plans", "max_replicas"), true);
      assert.equal(await runner.hasTable("user_roles"), true);
      assert.equal(await runner.hasColumn("users", "active"), true);
      assert.equal(await runner.hasColumn("roles", "active"), true);
    } finally { await runner.release(); }
  });
});
