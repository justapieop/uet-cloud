import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentSpec } from "@kumo/domain";
import type { Repository } from "typeorm";
import { InfraDeploymentRepository, type InfraDeployment } from "../dist/db/repositories/deployment.js";

test("deployment repository round-trips creation input and progress in the deployment row", async (): Promise<void> => {
  let stored: InfraDeployment | null = null;
  const orm: Pick<Repository<InfraDeployment>, "create" | "save" | "findOneBy"> = {
    create: ((record: InfraDeployment): InfraDeployment => record) as Repository<InfraDeployment>["create"],
    save: (async (record: InfraDeployment): Promise<InfraDeployment> => { stored = record; return record; }) as Repository<InfraDeployment>["save"],
    findOneBy: async (): Promise<InfraDeployment | null> => stored,
  };
  const adapter: InfraDeploymentRepository = new InfraDeploymentRepository(orm as Repository<InfraDeployment>);
  const spec: DeploymentSpec = { repo: "https://github.com/owner/repo", tag: "v1", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2, region: "japaneast", envVars: { NODE_ENV: "production" } };
  const deployment: Deployment = new Deployment({ id: "deployment", userId: "123", name: "sample-app", spec, status: "RUNNING", image: "registry/app:v1", buildId: "build", resourceId: "/azure/app", fqdn: "app.example.com" });
  await adapter.save(deployment);
  assert.deepEqual((await adapter.findById(deployment.id))?.getDetails(), deployment.getDetails());
  assert.equal((await adapter.findByIdAndUserId(deployment.id, "123"))?.resourceId, "/azure/app");
});
