import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntityManager, Repository } from "typeorm";
import type { DeploymentResourceBaseline, DeploymentResourceConfigurationDetails, DeploymentResourceUpdate } from "@kumo/domain";
import { InfraDeployment, InfraDeploymentRepository } from "../dist/db/repositories/deployment.js";
import { InfraDeploymentResourceUpdate, InfraDeploymentResourceUpdateRepository } from "../dist/db/repositories/deployment-resource-update.js";

const OPERATION_ID: string = "abcdef01-1234-4567-89ab-abcdef012345";
const DEPLOYMENT_ID: string = "abcdef02-1234-4567-89ab-abcdef012345";
const CLAIM_TOKEN: string = "abcdef03-1234-4567-89ab-abcdef012345";
const CONFIGURATION: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 0, maxScaling: 2 };
const BASELINE: DeploymentResourceBaseline = {
  configuration: CONFIGURATION, version: "v1", image: "registry/app:commit", revisionName: "app--v1",
  mainContainerName: "app", resourceId: "/apps/app", environmentId: "/environments/shared",
  revisionMode: "Single", runningStatus: "Running",
};

function record(): InfraDeploymentResourceUpdate {
  return {
    id: OPERATION_ID.toUpperCase(), deploymentId: DEPLOYMENT_ID, userId: "123",
    keyHash: "a".repeat(64), fingerprint: "b".repeat(64),
    requestedJson: JSON.stringify(CONFIGURATION), baselineJson: JSON.stringify(BASELINE),
    receiptJson: JSON.stringify({ operationId: OPERATION_ID, deploymentId: DEPLOYMENT_ID, status: "PENDING", requested: CONFIGURATION }),
    lifecycle: "RUNNING", billingCustomerId: "cus_test", status: "APPLYING",
    claimToken: CLAIM_TOKEN.toUpperCase(), claimExpiresAt: new Date(Date.now() + 120_000), heartbeatAt: new Date(),
    nextAttemptAt: new Date(), targetRevision: null, observedJson: null, noOp: null,
    errorCode: null, errorMessage: null, createdAt: new Date(), startedAt: new Date(), completedAt: null,
  };
}

test("ORM resource-update reads canonicalize SQL GUIDs without changing receipts", async (): Promise<void> => {
  const row: InfraDeploymentResourceUpdate = record();
  const manager: EntityManager = {
    getRepository: () => ({ findBy: async () => [row], findOneBy: async () => row, findOne: async () => row }),
  } as unknown as EntityManager;
  const repository: InfraDeploymentResourceUpdateRepository = new InfraDeploymentResourceUpdateRepository(manager);
  const updates: Array<DeploymentResourceUpdate | null> = await Promise.all([
    repository.findByIdAndUserId(OPERATION_ID, "123"), repository.findByKeyHash(row.keyHash),
    repository.findLatestByDeploymentId(DEPLOYMENT_ID, "123"),
  ]);
  for (let index: number = 0; index < updates.length; index += 1) {
    const update: DeploymentResourceUpdate | null = updates[index]!;
    assert.ok(update);
    assert.equal(update.id, OPERATION_ID);
    assert.equal(update.claimToken, CLAIM_TOKEN);
    assert.equal(update.receipt.operationId, update.id);
    assert.equal(JSON.stringify(update.receipt), row.receiptJson);
  }
});

test("raw UPDATE OUTPUT claims canonicalize the same GUIDs as ORM reads", async (): Promise<void> => {
  const row: InfraDeploymentResourceUpdate = record();
  // Match physical SQL column names, including uppercase GUIDs from the driver.
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(row).map(
    ([key, value]: [string, unknown]): [string, unknown] => [key.replace(/[A-Z]/g, (letter: string): string => `_${letter.toLowerCase()}`), value],
  ));
  const manager: EntityManager = {
    queryRunner: { isTransactionActive: true },
    query: async (sql: string): Promise<unknown[]> => {
      if (sql.includes("SELECT TOP")) return [{ id: row.id, deploymentId: row.deploymentId, userId: row.userId }];
      if (sql.includes("SELECT id FROM deployments")) return [{ id: DEPLOYMENT_ID }];
      return [raw];
    },
  } as unknown as EntityManager;
  const update: DeploymentResourceUpdate | null = await new InfraDeploymentResourceUpdateRepository(manager).claimNext();
  assert.ok(update);
  assert.equal(update.id, OPERATION_ID);
  assert.equal(update.claimToken, CLAIM_TOKEN);
  assert.equal(update.receipt.operationId, update.id);
});

test("deployment active command pointer matches the canonical resource-update ID", async (): Promise<void> => {
  const row: InfraDeployment = {
    id: DEPLOYMENT_ID, userId: "123", name: "app", status: "RUNNING", requestJson: null,
    image: null, buildId: null, resourceId: null, containerAppEnvironmentId: null,
    containerAppDeletedAt: null, deletionClaimToken: null, activeResourceUpdateId: OPERATION_ID.toUpperCase(),
    fqdn: null, error: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const repository: Repository<InfraDeployment> = { findOneBy: async () => row } as unknown as Repository<InfraDeployment>;
  assert.equal((await new InfraDeploymentRepository(repository).findById(DEPLOYMENT_ID))?.activeResourceUpdateId, OPERATION_ID);
  const empty: Repository<InfraDeployment> = { findOneBy: async () => ({ ...row, activeResourceUpdateId: null }) } as unknown as Repository<InfraDeployment>;
  assert.equal((await new InfraDeploymentRepository(empty).findById(DEPLOYMENT_ID))?.activeResourceUpdateId, null);
});
