import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { DataSource, type DataSourceOptions } from "typeorm";
import { idempotencyStoreContract, type IdempotencyStoreContractCase } from "@nestjs/idempotency/testing";
import { CreateDeploymentCase, DeploymentAlreadyExists, DeploymentQuotaExceeded, type UnitOfWork, type UnitOfWorkRepositories } from "@kumo/application";
import { Deployment, type DeploymentSpec } from "@kumo/domain";
import { DATABASE_MIGRATIONS, InfraDeployment, InfraDeploymentRepository, InfraPlan, InfraRole, InfraUser, SqlServerIdempotencyStore, TypeOrmUnitOfWork } from "../dist/db/index.js";

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
  const source: DataSource = new DataSource({ ...options, database, entities: [InfraUser, InfraRole, InfraDeployment, InfraPlan], migrations: DATABASE_MIGRATIONS, synchronize: false });
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

  const contract: IdempotencyStoreContractCase[] = idempotencyStoreContract((): SqlServerIdempotencyStore => new SqlServerIdempotencyStore(source), { concurrent: true });
  for (let index: number = 0; index < contract.length; index += 1) {
    const item: IdempotencyStoreContractCase = contract[index]!;
    await context.test(`SQL idempotency: ${item.name}`, item.run);
  }

  await context.test("the plan migration rolls back and reapplies without editing historical migrations", async (): Promise<void> => {
    await source.undoLastMigration({ transaction: "all" });
    const runner: ReturnType<DataSource["createQueryRunner"]> = source.createQueryRunner();
    try {
      assert.equal(await runner.hasColumn("plans", "stripe_product_id"), false);
      assert.equal(await runner.hasColumn("plans", "max_replicas"), false);
      await source.runMigrations({ transaction: "all" });
      assert.equal(await runner.hasColumn("plans", "stripe_product_id"), true);
      assert.equal(await runner.hasColumn("plans", "max_replicas"), true);
    } finally { await runner.release(); }
  });
});
