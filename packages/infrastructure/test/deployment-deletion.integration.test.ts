import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { DataSource, type DataSourceOptions } from "typeorm";
import { DeleteDeploymentCase, type DeploymentOperationLease, type UnitOfWork } from "@kumo/application";
import { Deployment, type DeploymentDetails, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import {
  DATABASE_MIGRATIONS,
  InfraBuild,
  InfraDeployment,
  InfraDeploymentOperationLock,
  InfraDeploymentRepository,
  InfraPlan,
  InfraRole,
  InfraUserRole,
  InfraUser,
  InfraVolume,
  TypeOrmUnitOfWork,
} from "../dist/db/index.js";

const ENABLED: boolean = process.env.RUN_SQLSERVER_TESTS === "true";
const SPEC: DeploymentSpec = {
  repo: "https://github.com/owner/repo",
  targetPort: 8080,
  maxVcpu: 0.5,
  maxMemory: 1,
  minScaling: 0,
  maxScaling: 2,
};

function createDeployment(status: DeploymentStatus, name: string, overrides: Partial<DeploymentDetails> = {}): Deployment {
  const details: DeploymentDetails = {
    id: randomUUID(),
    userId: "123",
    name,
    status,
    spec: SPEC,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return new Deployment(details);
}

test("SQL Server deletion claims, operation leases, stale recovery, and slot release are atomic", {
  skip: !ENABLED,
  timeout: 180_000,
}, async (context: TestContext): Promise<void> => {
  const password: string | undefined = process.env.TEST_SQLSERVER_PASSWORD;
  assert.ok(password, "TEST_SQLSERVER_PASSWORD is required; application database settings are never used");
  const database: string = `kumo_test_${randomUUID().replaceAll("-", "")}`;
  const options: DataSourceOptions = {
    type: "mssql",
    host: process.env.TEST_SQLSERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_SQLSERVER_PORT ?? "1433"),
    username: process.env.TEST_SQLSERVER_USER ?? "sa",
    password,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 20 },
    logging: false,
  };
  const admin: DataSource = new DataSource({ ...options, database: "master" });
  const source: DataSource = new DataSource({
    ...options,
    database,
    entities: [InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraPlan, InfraBuild, InfraVolume],
    migrations: DATABASE_MIGRATIONS,
    synchronize: false,
  });
  let created: boolean = false;
  context.after(async (): Promise<void> => {
    try {
      if (source.isInitialized) await source.destroy();
      if (created) {
        await admin.query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
        await admin.query(`DROP DATABASE [${database}]`);
      }
    } finally {
      if (admin.isInitialized) await admin.destroy();
    }
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

  const repository: InfraDeploymentRepository = new InfraDeploymentRepository(source.getRepository(InfraDeployment));
  const unitOfWork: UnitOfWork = new TypeOrmUnitOfWork(source);
  const operationLock: InfraDeploymentOperationLock = new InfraDeploymentOperationLock(source, 30_000);
  const deleteCase: DeleteDeploymentCase = new DeleteDeploymentCase(unitOfWork, operationLock);

  await context.test("two concurrent DELETE requests leave one owner-scoped pending deletion and one worker claim", async (): Promise<void> => {
    const deployment: Deployment = createDeployment("RUNNING", `delete-${randomUUID().slice(0, 8)}`, {
      resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app",
    });
    await repository.insert(deployment);
    const results: PromiseSettledResult<void>[] = await Promise.allSettled([
      deleteCase.exec({ id: deployment.id, userId: "123" }),
      deleteCase.exec({ id: deployment.id, userId: "123" }),
    ]);
    assert.ok(results.some((result: PromiseSettledResult<void>): boolean => result.status === "fulfilled"));
    assert.equal((await repository.findByIdAndUserId(deployment.id, "456")), null);
    assert.equal((await repository.findByIdAndUserId(deployment.id, "123"))?.status, "DELETE_PENDING");
    await assert.doesNotReject(deleteCase.exec({ id: deployment.id, userId: "123" }));
    assert.equal((await repository.claimNextDeletion())?.id, deployment.id);
    await assert.doesNotReject(deleteCase.exec({ id: deployment.id, userId: "123" }));
    assert.equal(await repository.claimNextDeletion(), null);
  });

  await context.test("DELETE and a provisioning worker claim cannot both win for one pending row", async (): Promise<void> => {
    const deployment: Deployment = createDeployment("PENDING", `claim-${randomUUID().slice(0, 8)}`);
    await repository.insert(deployment);
    const race: [PromiseSettledResult<void>, PromiseSettledResult<Deployment | null>] = await Promise.allSettled([
      deleteCase.exec({ id: deployment.id, userId: "123" }),
      repository.claimNextPending(),
    ]);
    const deletionWon: boolean = race[0].status === "fulfilled";
    const provisioningClaim: Deployment | null = race[1].status === "fulfilled" ? race[1].value : null;
    const provisioningWon: boolean = provisioningClaim?.id === deployment.id;
    assert.equal(Number(deletionWon) + Number(provisioningWon), 1);
    const current: Deployment | null = await repository.findByIdAndUserId(deployment.id, "123");
    assert.ok(current);
    assert.equal(current.status, deletionWon ? "DELETE_PENDING" : "PROVISIONING");
  });

  await context.test("a retry after storage-link cleanup failure requeues the tombstone without erasing app-deletion progress", async (): Promise<void> => {
    const appDeletedAt: Date = new Date(Date.now() - 30_000);
    const deployment: Deployment = createDeployment("DELETE_FAILED", `retry-${randomUUID().slice(0, 8)}`, {
      resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app",
      containerAppEnvironmentId: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared-env",
      containerAppDeletedAt: appDeletedAt,
      error: "Deployment storage-link cleanup failed",
    });
    await repository.insert(deployment);
    await deleteCase.exec({ id: deployment.id, userId: "123" });
    const retried: Deployment | null = await repository.findByIdAndUserId(deployment.id, "123");
    assert.equal(retried?.status, "DELETE_PENDING");
    assert.equal(retried?.error, null);
    assert.equal(retried?.containerAppDeletedAt?.getTime(), appDeletedAt.getTime());
  });

  await context.test("separate API instances cannot hold attach, detach, and delete leases for the same deployment", async (): Promise<void> => {
    const deploymentId: string = randomUUID();
    const secondLock: InfraDeploymentOperationLock = new InfraDeploymentOperationLock(source, 30_000);
    const thirdLock: InfraDeploymentOperationLock = new InfraDeploymentOperationLock(source, 30_000);
    const leases: Array<DeploymentOperationLease | null> = await Promise.all([
      operationLock.acquire(deploymentId, "attach"),
      secondLock.acquire(deploymentId, "detach"),
      thirdLock.acquire(deploymentId, "delete"),
    ]);
    assert.equal(leases.filter((lease: DeploymentOperationLease | null): boolean => lease !== null).length, 1);
    const attachLease: DeploymentOperationLease | null = leases[0] ?? null;
    const detachLease: DeploymentOperationLease | null = leases[1] ?? null;
    const deleteLease: DeploymentOperationLease | null = leases[2] ?? null;
    if (attachLease) await operationLock.release(attachLease);
    if (detachLease) await secondLock.release(detachLease);
    if (deleteLease) await thirdLock.release(deleteLease);
  });

  await context.test("stale deletion claims return to the queue with a safe recovery error", async (): Promise<void> => {
    const deployment: Deployment = createDeployment("DELETING", `stale-${randomUUID().slice(0, 8)}`, {
      updatedAt: new Date(Date.now() - 10 * 60_000),
    });
    await repository.insert(deployment);
    await repository.recoverStaleDeletions(new Date());
    const recovered: Deployment | null = await repository.findByIdAndUserId(deployment.id, "123");
    assert.equal(recovered?.status, "DELETE_PENDING");
    assert.equal(recovered?.error, "Deployment deletion was interrupted or timed out");
  });

  await context.test("the deployment slot is released after app absence even while storage-link cleanup remains failed", async (): Promise<void> => {
    const deployment: Deployment = createDeployment("DELETE_FAILED", `quota-${randomUUID().slice(0, 8)}`, {
      userId: "456",
      resourceId: "/subscriptions/sub/resourceGroups/user-rg-456/providers/Microsoft.App/containerApps/my-app",
      containerAppEnvironmentId: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared-env",
      error: "Deployment storage-link cleanup failed",
    });
    await repository.insert(deployment);
    assert.equal(await repository.countReservedByUserId("456"), 1);
    const appDeleted: Deployment = new Deployment({
      ...deployment.getDetails(),
      containerAppDeletedAt: new Date(),
      updatedAt: new Date(),
    });
    await repository.updateProgress(appDeleted);
    const afterCleanupFailure: Deployment | null = await repository.findByIdAndUserId(deployment.id, "456");
    assert.equal(afterCleanupFailure?.status, "DELETE_FAILED");
    assert.ok(afterCleanupFailure?.containerAppDeletedAt instanceof Date);
    assert.equal(afterCleanupFailure?.resourceId, deployment.resourceId);
    assert.equal(await repository.countReservedByUserId("456"), 0);
  });
});
