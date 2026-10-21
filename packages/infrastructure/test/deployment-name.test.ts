import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DeploymentAlreadyExists } from "@kumo/application";
import { Deployment } from "@kumo/domain";
import type { QueryRunner, Repository } from "typeorm";
import { UniqueDeploymentName1792540800000 } from "../dist/db/migrations.js";
import { InfraDeploymentRepository, type InfraDeployment } from "../dist/db/repositories/deployment.js";

test("duplicate existing names stop migration before removing the per-user constraint", async (): Promise<void> => {
  let dropped: boolean = false;
  const duplicate: Error = new Error("Duplicate deployment names");
  const runner: QueryRunner = {
    createIndex: async (): Promise<void> => { throw duplicate; },
    dropIndex: async (): Promise<void> => { dropped = true; },
  } as unknown as QueryRunner;

  await assert.rejects(new UniqueDeploymentName1792540800000().up(runner), (error: unknown): boolean => error === duplicate);
  assert.equal(dropped, false);
});

test("SQL duplicate names on create and update become deployment conflicts", async (): Promise<void> => {
  const deployment: Deployment = new Deployment({ id: "deployment-id", userId: "123", name: "shared-name" });
  const duplicateCodes: readonly number[] = [2601, 2627];
  for (let index: number = 0; index < duplicateCodes.length; index += 1) {
    const number: number = duplicateCodes[index]!;
    const repository: Repository<InfraDeployment> = {
      create: (record: Partial<InfraDeployment>): Partial<InfraDeployment> => record,
      save: async (): Promise<never> => { throw { driverError: { number } }; },
      update: async (): Promise<never> => { throw { driverError: { number } }; },
    } as unknown as Repository<InfraDeployment>;
    const adapter: InfraDeploymentRepository = new InfraDeploymentRepository(repository);
    const isConflict: (error: unknown) => boolean = (error: unknown): boolean =>
      error instanceof DeploymentAlreadyExists && error.message === "A deployment with this name already exists";
    await assert.rejects(adapter.save(deployment), isConflict);
    await assert.rejects(adapter.update(deployment), isConflict);
  }
});
