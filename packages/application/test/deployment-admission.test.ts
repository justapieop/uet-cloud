import assert from "node:assert/strict";
import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { Deployment, Plan, User, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, type StripeSubscriptionGateway } from "../dist/ports/stripe.js";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../dist/ports/deployment-request.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { CreateDeploymentCase, type CreateDeploymentInput } from "../dist/use-cases/deployment/CreateDeployment.case.js";

const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", tag: "v1", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 };
const PLAN: Plan = new Plan({ id: "starter", name: "Starter", price: 5, vcpu: 0.5, memory: 1, deployments: 2, disk: 10, maxReplicas: 2, stripeProductId: "prod_starter" });

class AdmissionFixture implements UnitOfWork, StripeSubscriptionGateway {
  public user: User = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
  public plans: Plan[] = [PLAN];
  public products: readonly string[] = ["prod_starter"];
  public deployments: Deployment[] = [];
  public receipts: Map<string, DeploymentRequestReceipt> = new Map<string, DeploymentRequestReceipt>();
  public stripeCalls: number = 0;
  public locked: boolean = false;
  public stripeFailure: boolean = false;
  public receiptFailure: boolean = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly transactionContext: AsyncLocalStorage<boolean> = new AsyncLocalStorage<boolean>();
  public readonly useCase: CreateDeploymentCase = new CreateDeploymentCase(this, this);

  public input(name: string = "my-app", key: string = name): CreateDeploymentInput {
    return { userId: "123", name, idempotencyKey: key, spec: { ...SPEC } };
  }

  public async getActiveSubscriptionProductIds(customerId: string): Promise<readonly string[]> {
    assert.notEqual(this.transactionContext.getStore(), true, "Stripe must not run inside a transaction");
    assert.equal(customerId, "cus_alice");
    this.stripeCalls += 1;
    if (this.stripeFailure) throw new SubscriptionCheckUnavailable("Stripe unavailable");
    return this.products;
  }

  public async run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    const previous: Promise<void> = this.tail;
    let release: () => void = (): void => {};
    this.tail = new Promise<void>((resolve: () => void): void => { release = resolve; });
    await previous;
    this.locked = false;
    const before: Deployment[] = [...this.deployments];
    const receiptsBefore: Map<string, DeploymentRequestReceipt> = new Map(this.receipts);
    const repositories: UnitOfWorkRepositories = {
      users: {
        findById: async (): Promise<User> => this.user,
        findByIdForUpdate: async (): Promise<User> => { this.locked = true; return this.user; },
        exists: async (): Promise<boolean> => true,
        save: async (): Promise<void> => {},
      },
      roles: {} as UnitOfWorkRepositories["roles"],
      plans: { findActiveByStripeProductIds: async (ids: readonly string[]): Promise<Plan[]> =>
        this.plans.filter((plan: Plan): boolean => plan.active && plan.stripeProductId !== null && ids.includes(plan.stripeProductId)) },
      deploymentRequests: {
        findForUpdate: async (key: string): Promise<DeploymentRequestReceipt | null> => this.receipts.get(key) ?? null,
        save: async (key: string, receipt: DeploymentRequestReceipt): Promise<void> => {
          if (this.receiptFailure) throw new Error("Receipt persistence failed");
          this.receipts.set(key, receipt);
        },
      },
      deployment: {
        findById: async (): Promise<null> => null,
        findByIdAndUserId: async (): Promise<null> => null,
        findByUserId: async (): Promise<Deployment[]> => { assert.equal(this.locked, true); return this.deployments; },
        save: async (deployment: Deployment): Promise<void> => { assert.equal(this.locked, true); this.deployments.push(deployment); },
        update: async (): Promise<void> => {},
        delete: async (): Promise<void> => {},
      },
    };
    try { return await this.transactionContext.run(true, (): Promise<T> => work(repositories)); }
    catch (error: unknown) { this.deployments = before; this.receipts = receiptsBefore; throw error; }
    finally { release(); }
  }
}

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
