import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentResourceUpdate } from "@kumo/domain";
import { DeploymentResourceUpdateError, ProcessDeploymentResourceUpdateCase } from "../dist/index.js";
import { ID, REQUESTED, ResourceAdmissionFixture, createUpdate } from "./support/resource-updates.ts";

interface Fixture { readonly setup: ResourceAdmissionFixture; readonly update: DeploymentResourceUpdate; readonly process: ProcessDeploymentResourceUpdateCase }
function fixture(status: "APPLYING" | "RECONCILING" = "APPLYING"): Fixture {
  const setup: ResourceAdmissionFixture = new ResourceAdmissionFixture();
  const update: DeploymentResourceUpdate = createUpdate({ status, claimToken: "30000000-0000-4000-8000-000000000001", claimExpiresAt: new Date(Date.now() + 60_000), heartbeatAt: new Date() });
  setup.updates.set(update.id, update);
  setup.deployments[0] = new Deployment({ ...setup.deployments[0]!.getDetails(), activeResourceUpdateId: update.id });
  return { setup, update, process: new ProcessDeploymentResourceUpdateCase(setup, setup, setup.updater, setup.lock, setup.queue) };
}

test("resource processing checkpoints the target before applying and finalizes verified resources", async (): Promise<void> => {
  const { setup, update, process }: Fixture = fixture();
  const original: Deployment = setup.deployments[0]!;
  setup.updater.update = async (input: Parameters<typeof setup.updater.update>[0]): ReturnType<typeof setup.updater.update> => {
    await input.onTargetRevision("my-app--resources");
    assert.equal(setup.updates.get(update.id)?.targetRevision, "my-app--resources");
    return { observed: REQUESTED, targetRevision: "my-app--resources", noOp: false };
  };
  await process.exec(update);
  assert.equal(setup.updates.get(update.id)?.status, "SUCCEEDED");
  assert.deepEqual(setup.updates.get(update.id)?.observed, REQUESTED);
  assert.equal(setup.deployments[0]?.activeResourceUpdateId, null);
  assert.equal(setup.deployments[0]?.status, original.status);
  assert.equal(setup.deployments[0]?.image, original.image);
  assert.deepEqual(setup.deployments[0]?.spec, original.spec);
});

test("uncertain Azure writes retain reconciliation ownership and are observed without another write", async (): Promise<void> => {
  const { setup, update, process }: Fixture = fixture();
  setup.updater.update = async (input: Parameters<typeof setup.updater.update>[0]): ReturnType<typeof setup.updater.update> => {
    setup.applyCalls++; await input.onTargetRevision("my-app--resources");
    throw new DeploymentResourceUpdateError("RESOURCE_OUTCOME_UNKNOWN", "Azure result is not confirmed", true);
  };
  await process.exec(update);
  assert.equal(setup.updates.get(update.id)?.status, "RECONCILING");
  assert.equal(setup.updates.get(update.id)?.completedAt, null);
  assert.equal(setup.deployments[0]?.activeResourceUpdateId, update.id);
  const reconciling: DeploymentResourceUpdate = createUpdate({ ...setup.updates.get(update.id)!.getDetails(), claimToken: update.claimToken, claimExpiresAt: new Date(Date.now() + 60_000) });
  setup.updates.set(update.id, reconciling); setup.unknownOutcome = true;
  await process.exec(reconciling);
  assert.equal(setup.applyCalls, 1);
  assert.equal(setup.reconcileCalls, 1);
  assert.equal(setup.updates.get(update.id)?.status, "RECONCILING");
  assert.equal(setup.deployments[0]?.activeResourceUpdateId, update.id);
});

test("expired subscription fails before resource mutation and leaves the existing application running", async (): Promise<void> => {
  const { setup, update, process }: Fixture = fixture();
  setup.products = [];
  await process.exec(update);
  assert.equal(setup.applyCalls, 0);
  assert.equal(setup.updates.get(update.id)?.status, "FAILED");
  assert.equal(setup.deployments[0]?.status, "RUNNING");
  assert.equal(setup.deployments[0]?.activeResourceUpdateId, null);
});

test("stale claim cannot finalize or clear another worker's active operation", async (): Promise<void> => {
  const { setup, update, process }: Fixture = fixture();
  const replacement: DeploymentResourceUpdate = createUpdate({ ...update.getDetails(), status: "RECONCILING", claimToken: "40000000-0000-4000-8000-000000000001" });
  setup.updates.set(update.id, replacement);
  await process.exec(update);
  assert.equal(setup.applyCalls, 0);
  assert.deepEqual(setup.updates.get(update.id)?.getDetails(), replacement.getDetails());
  assert.equal(setup.deployments.find((app: Deployment): boolean => app.id === ID)?.activeResourceUpdateId, update.id);
});
