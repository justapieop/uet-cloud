import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentSpec } from "@kumo/domain";
import { BuildProviderError } from "../dist/ports/build.js";
import type { DeploymentProvisioner, DeploymentProvisionResult, DeploymentRepository } from "../dist/ports/deployment.js";
import { ProcessDeploymentCase } from "../dist/use-cases/deployment/ProcessDeployment.case.js";
import { UpdateDeploymentCase } from "../dist/use-cases/deployment/UpdateDeployment.case.js";
import { DeleteDeploymentCase } from "../dist/use-cases/deployment/DeleteDeployment.case.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { emptyRepositories } from "./support/repositories.ts";

const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", tag: "v1", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 };
const CLAIMED: Deployment = new Deployment({ id: "deployment", userId: "123", name: "sample-app", status: "PROVISIONING", spec: SPEC });
const RESULT: DeploymentProvisionResult = { buildId: "build", image: "registry/app:v1", resourceId: "/azure/app", fqdn: "app.example.com" };

function repository(writes: Deployment[]): DeploymentRepository {
  return {
    ...emptyRepositories().deployment,
    findById: async (): Promise<Deployment> => CLAIMED,
    findByIdAndUserId: async (_id: string, userId: string): Promise<Deployment | null> => userId === "123" ? CLAIMED : null,
    findByUserId: async (): Promise<Deployment[]> => [CLAIMED],
    save: async (deployment: Deployment): Promise<void> => { writes.push(deployment); },
    update: async (deployment: Deployment): Promise<void> => { writes.push(deployment); },
    updateProgress: async (deployment: Deployment): Promise<void> => { writes.push(deployment); },
    delete: async (): Promise<void> => {},
  };
}

test("processing persists accepted build progress before saving Azure success", async (): Promise<void> => {
  const writes: Deployment[] = [];
  const provisioner: DeploymentProvisioner = { provisionDeployment: async (input, onBuildAccepted): Promise<DeploymentProvisionResult> => {
    assert.equal(input.id, CLAIMED.id);
    await onBuildAccepted(RESULT.buildId, RESULT.image);
    assert.equal(writes[0]?.status, "PROVISIONING");
    return RESULT;
  } };
  await new ProcessDeploymentCase(repository(writes), provisioner).exec(CLAIMED);
  assert.equal(writes[0]?.buildId, RESULT.buildId);
  assert.equal(writes[1]?.status, "RUNNING");
  assert.equal(writes[1]?.resourceId, RESULT.resourceId);
  assert.equal(writes[1]?.error, null);
});

test("processing rejects unclaimed requests before provisioning", async (): Promise<void> => {
  const provisioner: DeploymentProvisioner = { provisionDeployment: async (): Promise<never> => { throw new Error("Must not provision"); } };
  await assert.rejects(new ProcessDeploymentCase(repository([]), provisioner).exec(new Deployment({ ...CLAIMED.getDetails(), status: "PENDING" })), /claimed/);
});

test("provider failures preserve the accepted build and expose only safe errors", async (): Promise<void> => {
  const errors: Error[] = [new BuildProviderError("Build failed"), new Error("secret upstream response")];
  for (let index: number = 0; index < errors.length; index += 1) {
    const writes: Deployment[] = [];
    const provisioner: DeploymentProvisioner = { provisionDeployment: async (_input, onBuildAccepted): Promise<never> => {
      await onBuildAccepted(RESULT.buildId, RESULT.image);
      throw errors[index]!;
    } };
    await new ProcessDeploymentCase(repository(writes), provisioner).exec(CLAIMED);
    assert.equal(writes.at(-1)?.status, "FAILED");
    assert.equal(writes.at(-1)?.buildId, RESULT.buildId);
    assert.equal(writes.at(-1)?.error, index === 0 ? "Build failed" : "Deployment provisioning failed");
  }
});

test("update and delete use transaction-bound repositories and preserve ownership", async (): Promise<void> => {
  const writes: Deployment[] = [];
  const deployments: DeploymentRepository = repository(writes);
  const deleted: string[] = [];
  deployments.delete = async (id: string, userId: string): Promise<void> => { deleted.push(`${userId}/${id}`); };
  const uow: UnitOfWork = { run: async <T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => work({ ...emptyRepositories(), deployment: deployments }) };
  await new UpdateDeploymentCase(uow).exec({ id: CLAIMED.id, userId: "123", name: "renamed-app" });
  assert.equal(writes[0]?.name, "renamed-app");
  assert.equal(writes[0]?.spec?.tag, "v1");
  await assert.rejects(new UpdateDeploymentCase(uow).exec({ id: CLAIMED.id, userId: "456", name: "other-app" }), /not found/);
  await new DeleteDeploymentCase(uow).exec({ id: CLAIMED.id, userId: "123" });
  assert.deepEqual(deleted, ["123/deployment"]);
});
