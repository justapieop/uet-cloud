import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, Plan, User, type DeploymentResourceUpdateReceipt } from "@kumo/domain";
import { DeploymentNotFoundError, DeploymentQuotaExceeded, DeploymentRequestKeyReused, DeploymentResourceVersionMismatch, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable } from "../dist/index.js";
import { BASELINE, ID, REQUESTED, ResourceAdmissionFixture } from "./support/resource-updates.ts";

test("resource update queues once without changing applied resources or counting another deployment slot", async (): Promise<void> => {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  setup.deployments.push(new Deployment({ ...setup.deployments[0]!.getDetails(), id: "other", name: "other-app" }));
  const before: Deployment = setup.deployments[0]!;
  const receipt: DeploymentResourceUpdateReceipt = await setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED);
  assert.equal(receipt.status, "PENDING");
  assert.deepEqual(receipt.requested, REQUESTED);
  assert.equal(setup.updates.size, 1);
  assert.equal(setup.deployments.length, 2);
  assert.equal(setup.deployments[0]?.activeResourceUpdateId, receipt.operationId);
  assert.equal(setup.deployments[0]?.status, "RUNNING");
  assert.equal(setup.deployments[0]?.image, before.image);
  assert.deepEqual(setup.deployments[0]?.spec, before.spec);
  assert.equal(setup.applyCalls, 0);
  setup.stripeFailure = true;
  assert.deepEqual(await setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED), receipt);
  assert.equal(setup.stripeCalls, 1);
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, { ...REQUESTED, maxScaling: 4 }), DeploymentRequestKeyReused);
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", "different-version", REQUESTED), DeploymentRequestKeyReused);
});

test("resource update requires current ownership, user eligibility and active subscription even for a decrease", async (): Promise<void> => {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  await assert.rejects(setup.resourceCase.exec("foreign", "123", "key", BASELINE.version, REQUESTED), DeploymentNotFoundError);
  assert.equal(setup.stripeCalls, 0);
  setup.user = new User({ ...setup.user, active: false });
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED), DeploymentSubscriptionRequired);
  setup.user = new User({ ...setup.user, active: true });
  setup.products = [];
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, { maxVcpu: 0.25, maxMemory: 0.5, minScaling: 0, maxScaling: 1 }), DeploymentSubscriptionRequired);
  setup.products = ["prod_starter"]; setup.stripeFailure = true;
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED), SubscriptionCheckUnavailable);
  assert.equal(setup.updates.size, 0);
});

test("one active plan must cover per-replica CPU, RAM and replicas without mixing subscriptions", async (): Promise<void> => {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  setup.plans = [new Plan({ ...setup.plans[0]!, maxReplicas: 1 }), new Plan({ ...setup.plans[0]!, id: "scale", stripeProductId: "prod_scale", vcpu: 0.25, memory: 0.5, maxReplicas: 10 })];
  setup.products = ["prod_starter", "prod_scale"];
  await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED), DeploymentQuotaExceeded);
  assert.equal(setup.updates.size, 0);
  setup.plans = [new Plan({ ...setup.plans[0]!, maxReplicas: 5 })];
  assert.equal((await setup.resourceCase.exec(ID, "123", "key", BASELINE.version, { ...REQUESTED, maxVcpu: 2, maxMemory: 4, maxScaling: 5 })).status, "PENDING");
});

test("stopped deployment remains stopped and a stale configuration cannot be accepted", async (): Promise<void> => {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  setup.deployments[0] = new Deployment({ ...setup.deployments[0]!.getDetails(), status: "STOPPED" });
  setup.baseline = { ...BASELINE, runningStatus: "Stopped" };
  await assert.rejects(setup.resourceCase.exec(ID, "123", "stale", "old-version", REQUESTED), DeploymentResourceVersionMismatch);
  assert.equal(setup.updates.size, 0);
  await setup.resourceCase.exec(ID, "123", "valid", BASELINE.version, REQUESTED);
  assert.equal(setup.deployments[0]?.status, "STOPPED");
  assert.equal(setup.applyCalls, 0);
});

test("command receipt and active pointer roll back together on persistence failure", async (): Promise<void> => {
  const failures: readonly string[] = ["receipt", "pointer"];
  for (let index: number = 0; index < failures.length; index++) {
    const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
    setup.receiptFailure = failures[index] === "receipt"; setup.pointerFailure = failures[index] === "pointer";
    await assert.rejects(setup.resourceCase.exec(ID, "123", "key", BASELINE.version, REQUESTED), /persistence/i);
    assert.equal(setup.updates.size, 0);
    assert.equal(setup.deployments[0]?.activeResourceUpdateId, null);
  }
});
