import assert from "node:assert/strict";

import { AsyncLocalStorage } from "node:async_hooks";
import { Deployment, Plan, User, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, type StripeSubscriptionGateway } from "../../dist/ports/stripe.js";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../../dist/ports/deployment-request.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../dist/ports/uow.js";
import { CreateDeploymentCase, type CreateDeploymentInput } from "../../dist/use-cases/deployment/CreateDeployment.case.js";

export const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", tag: "v1", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 };
export const PLAN: Plan = new Plan({ id: "starter", name: "Starter", price: 5, vcpu: 0.5, memory: 1, deployments: 2, disk: 10, maxReplicas: 2, stripeProductId: "prod_starter" });

export class AdmissionFixture implements UnitOfWork, StripeSubscriptionGateway {
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

