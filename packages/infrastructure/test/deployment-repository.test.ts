import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentSpec } from "@kumo/domain";
import { DeploymentProgressConflictError } from "@kumo/application";
import { FindOperator, type FindOptionsWhere, type InsertResult, type Repository, type UpdateResult } from "typeorm";
import { InfraDeploymentRepository, type InfraDeployment } from "../dist/db/repositories/deployment.js";

test("deployment repository round-trips creation input and progress in the deployment row", async (): Promise<void> => {
  let stored: InfraDeployment | null = null;
  const orm: Pick<Repository<InfraDeployment>, "update" | "insert" | "findOneBy"> = {
    update: (async (criteria: FindOptionsWhere<InfraDeployment>, changes: Partial<InfraDeployment>): Promise<UpdateResult> => {
      assert.ok(criteria.activeResourceUpdateId instanceof FindOperator);
      assert.equal(criteria.activeResourceUpdateId.type, "isNull");
      const matches: boolean = stored !== null && criteria.id === stored.id && criteria.userId === stored.userId &&
        criteria.status === stored.status && stored.activeResourceUpdateId === null;
      if (matches) stored = { ...stored!, ...changes };
      return { affected: matches ? 1 : 0, generatedMaps: [], raw: [] };
    }) as Repository<InfraDeployment>["update"],
    insert: (async (record: Partial<InfraDeployment>): Promise<InsertResult> => {
      assert.equal(stored, null, "An existing deployment must be updated through the guarded write");
      stored = { ...record, activeResourceUpdateId: null } as InfraDeployment;
      return { identifiers: [{ id: record.id }], generatedMaps: [], raw: [] };
    }) as Repository<InfraDeployment>["insert"],
    findOneBy: async (criteria: FindOptionsWhere<InfraDeployment>): Promise<InfraDeployment | null> =>
      stored && criteria.id === stored.id && (criteria.userId === undefined || criteria.userId === stored.userId) ? stored : null,
  };
  const adapter: InfraDeploymentRepository = new InfraDeploymentRepository(orm as Repository<InfraDeployment>);
  const spec: DeploymentSpec = { repo: "https://github.com/owner/repo", targetPort: 8080, external: false, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2, region: "japaneast", envVars: { NODE_ENV: "production" } };
  const deployment: Deployment = new Deployment({ id: "deployment", userId: "123", name: "sample-app", spec, status: "RUNNING", image: "registry/app:v1", buildId: "build", resourceId: "/azure/app", fqdn: "app.example.com" });
  await adapter.save(deployment);
  assert.deepEqual((await adapter.findById(deployment.id))?.getDetails(), deployment.getDetails());
  assert.equal((await adapter.findByIdAndUserId(deployment.id, "123"))?.resourceId, "/azure/app");
  assert.equal(await adapter.findByIdAndUserId(deployment.id, "other-owner"), null);
  const changed: Deployment = new Deployment({ ...deployment.getDetails(), image: "registry/app:v2" });
  await adapter.save(changed);
  assert.equal((await adapter.findById(deployment.id))?.image, "registry/app:v2");
  stored = { ...(await orm.findOneBy({ id: deployment.id }))!, activeResourceUpdateId: "00000000-0000-4000-8000-000000000001" };
  await assert.rejects(adapter.save(deployment), DeploymentProgressConflictError);
  assert.equal((await adapter.findById(deployment.id))?.image, "registry/app:v2");
  assert.equal((await adapter.findById(deployment.id))?.activeResourceUpdateId, "00000000-0000-4000-8000-000000000001");
});
