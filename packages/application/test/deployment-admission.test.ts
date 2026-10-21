import assert from "node:assert/strict";
import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { Deployment, Plan, User, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, type StripeSubscriptionGateway } from "../dist/ports/stripe.js";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../dist/ports/deployment-request.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { CreateDeploymentCase, type CreateDeploymentInput } from "../dist/use-cases/deployment/CreateDeployment.case.js";

import { AdmissionFixture, SPEC, PLAN } from "./support/admission.ts";

test("active plan admits exact per-deployment CPU/RAM and replica limits without summing CPU across deployments", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  const first: Deployment = await fixture.useCase.exec(fixture.input("first-app"));
  const second: Deployment = await fixture.useCase.exec(fixture.input("second-app"));
  assert.equal(first.status, "PENDING");
  assert.equal(second.status, "PENDING");
  assert.equal(fixture.stripeCalls, 2);
  assert.equal(fixture.deployments.length, 2);
  assert.equal(fixture.receipts.size, 2);
});

test("missing association, no active subscriptions, and inactive or unmapped plans reject before acceptance", async (): Promise<void> => {
  const fixtures: AdmissionFixture[] = Array.from({ length: 4 }, (): AdmissionFixture => new AdmissionFixture());
  fixtures[0]!.user = new User({ ...fixtures[0]!.user, stripeCustomerId: null });
  fixtures[1]!.products = [];
  fixtures[2]!.plans = [];
  fixtures[3]!.plans = [new Plan({ ...PLAN, active: false })];
  for (let index: number = 0; index < fixtures.length; index += 1) {
    const fixture: AdmissionFixture = fixtures[index]!;
    await assert.rejects(fixture.useCase.exec(fixture.input()), DeploymentSubscriptionRequired);
    assert.equal(fixture.deployments.length, 0);
    assert.equal(fixture.receipts.size, 0);
  }
  assert.equal(fixtures[0]!.stripeCalls, 0);
});

test("Stripe failures fail closed and do not create a deployment", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.stripeFailure = true;
  await assert.rejects(fixture.useCase.exec(fixture.input()), SubscriptionCheckUnavailable);
  assert.equal(fixture.deployments.length, 0);
});

test("oversized CPU/RAM or replica requests are rejected without reserving quota", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  const oversized: CreateDeploymentInput = { ...fixture.input(), spec: { ...SPEC, maxVcpu: 0.75, maxMemory: 1.5 } };
  await assert.rejects(fixture.useCase.exec(oversized), DeploymentQuotaExceeded);
  await assert.rejects(fixture.useCase.exec({ ...fixture.input(), spec: { ...SPEC, maxScaling: 3 } }), DeploymentQuotaExceeded);
  assert.equal(fixture.deployments.length, 0);
});

test("pending, provisioning, running and failed apps with Azure resources reserve deployment slots", async (): Promise<void> => {
  const statuses: readonly DeploymentStatus[] = ["PENDING", "PROVISIONING", "RUNNING", "FAILED", "DELETED"];
  for (let index: number = 0; index < statuses.length; index += 1) {
    const fixture: AdmissionFixture = new AdmissionFixture();
    fixture.plans = [new Plan({ ...PLAN, deployments: 1 })];
    const status: DeploymentStatus = statuses[index]!;
    fixture.deployments = [new Deployment({ id: "existing", userId: "123", name: "existing-app", spec: SPEC, status, resourceId: status === "FAILED" ? "/azure/app" : null })];
    if (status === "DELETED") await fixture.useCase.exec(fixture.input());
    else await assert.rejects(fixture.useCase.exec(fixture.input()), DeploymentQuotaExceeded);
  }
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.plans = [new Plan({ ...PLAN, deployments: 1 })];
  fixture.deployments = [new Deployment({ id: "failed", userId: "123", name: "failed-app", spec: SPEC, status: "FAILED" })];
  await fixture.useCase.exec(fixture.input());
});

test("two concurrent requests for the last slot accept exactly one", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.plans = [new Plan({ ...PLAN, deployments: 1 })];
  const results: PromiseSettledResult<Deployment>[] = await Promise.allSettled([
    fixture.useCase.exec(fixture.input("first-app")), fixture.useCase.exec(fixture.input("second-app")),
  ]);
  assert.equal(results.filter((result: PromiseSettledResult<Deployment>): boolean => result.status === "fulfilled").length, 1);
  const rejected: PromiseSettledResult<Deployment> | undefined = results.find((result: PromiseSettledResult<Deployment>): boolean => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof DeploymentQuotaExceeded);
  assert.equal(fixture.deployments.length, 1);
});

test("accepted retries replay after subscription expiry without reserving twice; changed payloads reject", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  const input: CreateDeploymentInput = fixture.input();
  const accepted: Deployment = await fixture.useCase.exec(input);
  fixture.products = [];
  fixture.stripeFailure = true;
  assert.equal((await fixture.useCase.exec(input)).id, accepted.id);
  assert.equal(fixture.stripeCalls, 1);
  assert.equal(fixture.deployments.length, 1);
  await assert.rejects(fixture.useCase.exec({ ...input, name: "changed-app" }), DeploymentRequestKeyReused);
});

test("receipt failure rolls back quota reservation and suspended users cannot replay", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.receiptFailure = true;
  await assert.rejects(fixture.useCase.exec(fixture.input()), /Receipt persistence failed/);
  assert.equal(fixture.deployments.length, 0);
  fixture.receiptFailure = false;
  await fixture.useCase.exec(fixture.input());
  fixture.user = new User({ ...fixture.user, suspended: true });
  await assert.rejects(fixture.useCase.exec(fixture.input()), DeploymentSubscriptionRequired);
});

test("multiple subscribed plans cannot combine separate quota dimensions", async (): Promise<void> => {
  const fixture: AdmissionFixture = new AdmissionFixture();
  fixture.products = ["prod_large", "prod_many"];
  fixture.plans = [
    new Plan({ ...PLAN, id: "large", stripeProductId: "prod_large", vcpu: 1, memory: 2, deployments: 1 }),
    new Plan({ ...PLAN, id: "many", stripeProductId: "prod_many", deployments: 3 }),
  ];
  fixture.deployments = [new Deployment({ id: "existing", userId: "123", name: "existing-app", spec: SPEC, status: "RUNNING" })];
  await assert.rejects(fixture.useCase.exec({ ...fixture.input(), spec: { ...SPEC, maxVcpu: 1, maxMemory: 2 } }), DeploymentQuotaExceeded);
  await fixture.useCase.exec(fixture.input());
});
