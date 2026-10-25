import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, User, type DeploymentStatus } from "@kumo/domain";
import { RedeployDeploymentCase, DeploymentNotFoundError, InvalidDeploymentStatusError, DeploymentSubscriptionRequired } from "../dist/index.js";
import { AdmissionFixture, SPEC } from "./support/admission.ts";

function fixture(status: DeploymentStatus = "RUNNING"): AdmissionFixture {
  const setup: AdmissionFixture = new AdmissionFixture();
  setup.deployments = [new Deployment({ id: "deployment", userId: "123", name: "my-app", status,
    resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app", spec: SPEC, buildId: "previous", image: "old-image" })];
  return setup;
}

test("redeploy reserves no additional slot, queues once, and replays its durable receipt without Stripe", async (): Promise<void> => {
  const setup: AdmissionFixture = fixture();
  const useCase: RedeployDeploymentCase = new RedeployDeploymentCase(setup, setup);
  const accepted: Deployment = await useCase.exec("deployment", "123", "key");
  assert.equal(accepted.status, "PENDING");
  assert.equal(accepted.buildId, null);
  assert.equal(setup.deployments.length, 1);
  assert.deepEqual(accepted.spec, setup.deployments[0]!.spec);
  setup.products = [];
  assert.equal((await useCase.exec("deployment", "123", "key")).id, accepted.id);
  assert.equal(setup.stripeCalls, 1);
  setup.products = ["prod_starter"];
  await assert.rejects(useCase.exec("deployment", "123", "different-key"), InvalidDeploymentStatusError);
});

test("redeploy rejects foreign deployments, inactive users and expired subscriptions", async (): Promise<void> => {
  const setup: AdmissionFixture = fixture();
  const useCase: RedeployDeploymentCase = new RedeployDeploymentCase(setup, setup);
  await assert.rejects(useCase.exec("foreign", "123", "key"), DeploymentNotFoundError);
  assert.equal(setup.stripeCalls, 0);
  setup.user = new User({ ...setup.user, active: false });
  await assert.rejects(useCase.exec("deployment", "123", "key"), DeploymentSubscriptionRequired);
  setup.user = new User({ ...setup.user, active: true });
  setup.products = [];
  await assert.rejects(useCase.exec("deployment", "123", "key"), DeploymentSubscriptionRequired);
  assert.equal(setup.deployments[0]?.status, "RUNNING");
});

test("receipt failure rolls back queued redeployment and busy/stopped deployments cannot redeploy", async (): Promise<void> => {
  const setup: AdmissionFixture = fixture();
  setup.receiptFailure = true;
  await assert.rejects(new RedeployDeploymentCase(setup, setup).exec("deployment", "123", "key"), /Receipt persistence/);
  assert.equal(setup.deployments[0]?.status, "RUNNING");
  assert.equal(setup.receipts.size, 0);
  const statuses: DeploymentStatus[] = ["STOPPED", "STOPPING", "STARTING", "PENDING", "PROVISIONING"];
  for (let index: number = 0; index < statuses.length; index++) {
    const busy: AdmissionFixture = fixture(statuses[index]!);
    await assert.rejects(new RedeployDeploymentCase(busy, busy).exec("deployment", "123", "key"), InvalidDeploymentStatusError);
  }
});
