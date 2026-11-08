import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { DataSource, type DataSourceOptions } from "typeorm";
import type { UnitOfWorkRepositories } from "@kumo/application";
import { Deployment, type DeploymentResourceUpdate, type DeploymentStatus } from "@kumo/domain";
import {
  DATABASE_MIGRATIONS, InfraBuild, InfraDeployment, InfraDeploymentRepository,
  InfraDeploymentResourceUpdate, InfraDeploymentResourceUpdateRepository,
  InfraPlan, InfraRole, InfraUser, InfraUserRole, InfraVolume, TypeOrmUnitOfWork,
} from "../dist/db/index.js";
import { BASELINE, ID, REQUESTED, createUpdate } from "../../application/test/support/resource-updates.ts";

const ENABLED: boolean = process.env.RUN_SQLSERVER_TESTS === "true";

test("SQL Server resource updates keep acceptance atomic, fence stale claims and block conflicting mutations", {
  skip: !ENABLED, timeout: 180_000,
}, async (context: TestContext): Promise<void> => {
  const password: string | undefined = process.env.TEST_SQLSERVER_PASSWORD;
  assert.ok(password, "TEST_SQLSERVER_PASSWORD is required; application database settings are never loaded");
  const database: string = `kumo_test_${randomUUID().replaceAll("-", "")}`;
  const options: DataSourceOptions = {
    type: "mssql", host: process.env.TEST_SQLSERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_SQLSERVER_PORT ?? "1433"), username: process.env.TEST_SQLSERVER_USER ?? "sa", password,
    options: { encrypt: false, trustServerCertificate: true }, pool: { max: 10 }, logging: false,
  };
  const admin: DataSource = new DataSource({ ...options, database: "master" });
  const source: DataSource = new DataSource({
    ...options, database,
    entities: [InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraPlan, InfraBuild, InfraVolume, InfraDeploymentResourceUpdate],
    migrations: DATABASE_MIGRATIONS, synchronize: false,
  });
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
  await source.getRepository(InfraUser).save({ id: "123", displayName: "Alice", active: true, suspended: false, stripeCustomerId: "cus_alice" });

  const deployments: InfraDeploymentRepository = new InfraDeploymentRepository(source.getRepository(InfraDeployment));
  const updates: InfraDeploymentResourceUpdateRepository = new InfraDeploymentResourceUpdateRepository(source.manager);
  const uow: TypeOrmUnitOfWork = new TypeOrmUnitOfWork(source);
  const original: Deployment = new Deployment({
    id: ID, userId: "123", name: BASELINE.mainContainerName, status: "RUNNING", resourceId: BASELINE.resourceId,
    spec: { repo: "https://github.com/fixture/repo", targetPort: 8080, ...BASELINE.configuration },
    image: BASELINE.image, buildId: "original-build", createdAt: new Date(), updatedAt: new Date(),
  });
  await deployments.insert(original);

  async function store(update: DeploymentResourceUpdate, fail: boolean = false): Promise<void> {
    await uow.run(async (repositories: UnitOfWorkRepositories): Promise<void> => {
      await repositories.users.findByIdForUpdate("123");
      assert.ok(repositories.deployment.findByIdAndUserIdForUpdate);
      await repositories.deployment.findByIdAndUserIdForUpdate(ID, "123");
      assert.ok(repositories.deploymentResourceUpdates);
      await repositories.deploymentResourceUpdates.insert(update);
      assert.ok(repositories.deployment.setActiveResourceUpdate);
      assert.equal(await repositories.deployment.setActiveResourceUpdate(ID, "123", update.id), true);
      if (fail) throw new Error("Injected failure after command, receipt and pointer writes");
    });
  }

  await context.test("acceptance rollback removes command and receipt as well as the active pointer", async (): Promise<void> => {
    const update: DeploymentResourceUpdate = createUpdate({ id: randomUUID() });
    await assert.rejects(store(update, true), /Injected failure/);
    assert.equal(await updates.findByIdAndUserId(update.id, "123"), null);
    assert.equal(await updates.findByKeyHash(update.keyHash), null);
    const current: Deployment | null = await deployments.findByIdAndUserId(ID, "123");
    assert.equal(current?.activeResourceUpdateId, null);
    assert.equal(current?.status, "RUNNING");
    assert.equal(current?.image, original.image);
    assert.deepEqual(current?.spec, original.spec);
  });

  await context.test("two workers claim once; expired work reconciles without releasing its pointer or accepting a stale token", async (): Promise<void> => {
    const update: DeploymentResourceUpdate = createUpdate({ id: randomUUID() });
    await store(update);
    const otherWorker: InfraDeploymentResourceUpdateRepository = new InfraDeploymentResourceUpdateRepository(source.manager);
    const claims: Array<DeploymentResourceUpdate | null> = await Promise.all([updates.claimNext(), otherWorker.claimNext()]);
    const winners: DeploymentResourceUpdate[] = claims.filter((claim: DeploymentResourceUpdate | null): claim is DeploymentResourceUpdate => claim !== null);
    assert.equal(winners.length, 1);
    const claimed: DeploymentResourceUpdate = winners[0]!;
    assert.equal(claimed.status, "APPLYING");
    assert.ok(claimed.claimToken);
    assert.equal(await updates.heartbeat(claimed.id, "123", claimed.claimToken), true);
    assert.equal(await updates.heartbeat(claimed.id, "456", claimed.claimToken), false);
    assert.equal(await updates.findByIdAndUserId(claimed.id, "456"), null);
    // Age fixture timestamps only; recovery and fencing execute production SQL.
    await source.query(`UPDATE deployment_resource_updates
      SET claim_expires_at = DATEADD(MINUTE, -5, SYSUTCDATETIME()), heartbeat_at = DATEADD(MINUTE, -5, SYSUTCDATETIME()) WHERE id = @0`, [claimed.id]);
    assert.equal(await updates.recoverStaleClaims(), 1);
    assert.equal(await updates.updateClaimed({
      operationId: claimed.id, userId: "123", claimToken: claimed.claimToken,
      expectedStatus: "APPLYING", status: "SUCCEEDED", observed: REQUESTED,
    }), false);
    assert.equal(await updates.heartbeat(claimed.id, "123", claimed.claimToken), false);
    const recovered: DeploymentResourceUpdate | null = await updates.findByIdAndUserId(claimed.id, "123");
    assert.equal(recovered?.status, "RECONCILING");
    assert.equal(recovered?.completedAt, null);
    assert.notEqual(recovered?.claimToken, claimed.claimToken);
    assert.deepEqual(recovered?.receipt, update.receipt);
    assert.equal((await deployments.findByIdAndUserId(ID, "123"))?.activeResourceUpdateId, update.id);
    assert.equal((await deployments.findByIdAndUserId(ID, "123"))?.status, "RUNNING");
  });

  await context.test("an active reconciliation blocks stop, redeploy, deletion and stale worker progress", async (): Promise<void> => {
    const current: Deployment | null = await deployments.findByIdAndUserId(ID, "123");
    assert.ok(current?.activeResourceUpdateId);
    const transitions: readonly DeploymentStatus[] = ["STOPPING", "PENDING", "DELETE_PENDING"];
    for (let index: number = 0; index < transitions.length; index++) {
      const next: DeploymentStatus = transitions[index]!;
      assert.equal(await deployments.transitionStatus(ID, "123", "RUNNING", next), false, `Active resource update must block ${next}`);
    }
    await assert.rejects(deployments.updateProgress(new Deployment({ ...original.getDetails(), image: "stale-worker-image" }), { expectedStatus: "RUNNING" }));
    const after: Deployment | null = await deployments.findByIdAndUserId(ID, "123");
    assert.equal(after?.status, "RUNNING");
    assert.equal(after?.image, original.image);
    assert.equal(after?.activeResourceUpdateId, current.activeResourceUpdateId);
    assert.deepEqual(after?.spec, original.spec);
  });
});
