import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, DeploymentResourceUpdate, Plan, User, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails, type DeploymentResourceUpdateReceipt } from "@kumo/domain";
import {
  DeploymentNotFoundError, DeploymentOperationConflictError, DeploymentQuotaExceeded, DeploymentRequestKeyReused,
  DeploymentResourceUpdateError, DeploymentResourceUpdateNotFound, DeploymentResourceVersionMismatch, DeploymentResourceVersionRequired,
  DeploymentSubscriptionRequired, GetDeploymentResourceUpdateCase, ProcessDeploymentResourceUpdateCase, UpdateDeploymentResourcesCase,
  type DeploymentConfigurationUpdater, type DeploymentOperationLock, type DeploymentResourceReconcileResult,
  type DeploymentResourceUpdateQueueRepository, type StripeSubscriptionGateway, type UnitOfWork, type UnitOfWorkRepositories,
} from "../dist/index.js";

const ID: string = "abcdef01-1234-4567-89ab-abcdef012345";
const TOKEN: string = "abcdef02-1234-4567-89ab-abcdef012345";
const REQUEST: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 0, maxScaling: 3 };
const BASELINE: DeploymentResourceBaseline = {
  configuration: { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 }, version: "version-1", image: "registry/app:commit",
  mainContainerName: "app", revisionName: "app--old", resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/app",
  environmentId: "/environments/shared", revisionMode: "Single", runningStatus: "Running",
};
interface Fixture {
  user: User | null; app: Deployment | null; plans: Plan[]; products: string[]; commands: Map<string, DeploymentResourceUpdate>;
  inTransaction: boolean; billingCalls: number; writes: number; reconciles: number; cacheCalls: number;
  pointerFailure: boolean; afterBilling?: () => void; afterInsert?: () => void;
  reconcileResult: DeploymentResourceReconcileResult; baseline: DeploymentResourceBaseline;
  accept: UpdateDeploymentResourcesCase; process: ProcessDeploymentResourceUpdateCase; query: GetDeploymentResourceUpdateCase;
  updater: DeploymentConfigurationUpdater; queue: DeploymentResourceUpdateQueueRepository;
}
function fixture(): Fixture {
  const unused: () => Promise<never> = async (): Promise<never> => { throw new Error("Unexpected dependency in resource update test"); };
  const state: Omit<Fixture, "accept" | "process" | "query" | "updater" | "queue"> = {
    user: new User({ id: "123", displayName: "Owner", active: true, suspended: false, stripeCustomerId: "cus_owner" }),
    app: new Deployment({ id: ID, userId: "123", name: "app", status: "RUNNING", resourceId: BASELINE.resourceId, image: BASELINE.image }),
    plans: [new Plan({ id: "plan", name: "Plan", price: 5, vcpu: 2, memory: 4, maxReplicas: 5, deployments: 1, disk: 32, stripeProductId: "prod_plan" })],
    products: ["prod_plan"], commands: new Map<string, DeploymentResourceUpdate>(), inTransaction: false,
    billingCalls: 0, writes: 0, reconciles: 0, cacheCalls: 0, pointerFailure: false, baseline: BASELINE,
    reconcileResult: { outcome: "succeeded", observed: REQUEST, targetRevision: "app--target", noOp: false },
  };
  const queue: DeploymentResourceUpdateQueueRepository = {
    findByIdAndUserId: async (id: string, userId: string): Promise<DeploymentResourceUpdate | null> => {
      const row: DeploymentResourceUpdate | undefined = state.commands.get(id); return row?.userId === userId ? row : null;
    },
    findByKeyHash: async (hash: string): Promise<DeploymentResourceUpdate | null> => [...state.commands.values()].find((row: DeploymentResourceUpdate): boolean => row.keyHash === hash) ?? null,
    findLatestByDeployment: async (id: string, userId: string): Promise<DeploymentResourceUpdate | null> => [...state.commands.values()].find((row: DeploymentResourceUpdate): boolean => row.deploymentId === id && row.userId === userId) ?? null,
    insert: async (row: DeploymentResourceUpdate): Promise<void> => { assert.equal(state.inTransaction, true); state.commands.set(row.id, row); state.afterInsert?.(); },
    claimNext: unused, heartbeat: unused, recoverStaleClaims: unused,
    updateClaimed: async (input: Parameters<DeploymentResourceUpdateQueueRepository["updateClaimed"]>[0]): Promise<boolean> => {
      const row: DeploymentResourceUpdate | undefined = state.commands.get(input.operationId);
      if (!row || row.claimToken !== input.claimToken || row.userId !== input.userId || row.status !== input.expectedStatus || row.completedAt || !row.claimExpiresAt || row.claimExpiresAt.getTime() <= Date.now() || state.app?.activeResourceUpdateId !== row.id) return false;
      const terminal: boolean = input.status === "SUCCEEDED" || input.status === "FAILED";
      const release: boolean = terminal || input.releaseClaim === true;
      state.commands.set(row.id, new DeploymentResourceUpdate({ ...row.getDetails(), status: input.status,
        claimToken: release ? null : row.claimToken, claimExpiresAt: release ? null : row.claimExpiresAt,
        targetRevision: input.targetRevision === undefined ? row.targetRevision : input.targetRevision,
        observed: input.observed === undefined ? row.observed : input.observed, noOp: input.noOp === undefined ? row.noOp : input.noOp,
        errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null, completedAt: terminal ? new Date() : null,
      }));
      if (terminal && state.app) state.app = new Deployment({ ...state.app.getDetails(), activeResourceUpdateId: null });
      return true;
    },
  };
  const findApp: (id: string, userId: string) => Promise<Deployment | null> = async (id: string, userId: string): Promise<Deployment | null> => state.app?.id === id && state.app.userId === userId ? state.app : null;
  const repos: UnitOfWorkRepositories = {
    users: { findById: async (): Promise<User | null> => state.user, findByIdForUpdate: async (): Promise<User | null> => state.user, exists: unused, save: unused },
    deployment: {
      findByIdAndUserId: findApp, findByIdAndUserIdForUpdate: findApp,
      setActiveResourceUpdate: async (_id: string, _user: string, operationId: string): Promise<boolean> => {
        if (state.pointerFailure) throw new Error("Injected pointer failure");
        if (!state.app || state.app.activeResourceUpdateId) return false;
        state.app = new Deployment({ ...state.app.getDetails(), activeResourceUpdateId: operationId }); return true;
      },
      findById: unused, findByUserId: unused, countReservedByUserId: unused, save: unused, insert: unused,
      update: unused, updateProgress: unused, transitionStatus: unused, delete: unused,
    },
    deploymentResourceUpdates: queue,
    scaleRules: { findByDeploymentId: unused, save: unused, delete: unused },
    plans: { findActiveByStripeProductIds: async (products: readonly string[]): Promise<Plan[]> => state.plans.filter((plan: Plan): boolean => plan.active && plan.stripeProductId !== null && products.includes(plan.stripeProductId)) },
    roles: { findById: unused, findByIdForUpdate: unused, findByIds: unused, findAll: unused, findActiveByUserId: unused, save: unused, insert: unused, replace: unused, deactivate: unused },
    userRoles: { findByUserId: unused, replaceForUser: unused }, deploymentRequests: { findForUpdate: unused, save: unused },
    volumes: { findById: unused, findByIdAndUserId: unused, findByNameAndUserId: unused, findByUserId: unused, save: unused, delete: unused },
  };
  const uow: UnitOfWork = { run: async <T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
    assert.equal(state.inTransaction, false);
    const before: Map<string, DeploymentResourceUpdate> = new Map(state.commands);
    const app: Deployment | null = state.app;
    state.inTransaction = true;
    try { return await work(repos); } catch (error: unknown) { state.commands = before; state.app = app; throw error; }
    finally { state.inTransaction = false; }
  } };
  const billing: StripeSubscriptionGateway = { getActiveSubscriptionProductIds: async (): Promise<string[]> => {
    assert.equal(state.inTransaction, false); state.billingCalls++; state.afterBilling?.(); return state.products;
  } };
  const updater: DeploymentConfigurationUpdater = {
    supportsStopped: false,
    readBaseline: async (): Promise<DeploymentResourceBaseline> => { assert.equal(state.inTransaction, false); return state.baseline; },
    update: async (input: Parameters<DeploymentConfigurationUpdater["update"]>[0]): ReturnType<DeploymentConfigurationUpdater["update"]> => {
      assert.equal(state.inTransaction, false); await input.onTargetRevision("app--target"); state.writes++;
      return { observed: input.requested, targetRevision: "app--target", noOp: false };
    },
    reconcile: async (): ReturnType<DeploymentConfigurationUpdater["reconcile"]> => { assert.equal(state.inTransaction, false); state.reconciles++; return state.reconcileResult; },
  };
  const lock: DeploymentOperationLock = { leaseDurationMs: 120_000, acquire: async (deploymentId, operation) => ({ deploymentId, operation, token: "lease" }), renew: async (): Promise<boolean> => true, release: async (): Promise<void> => {} };
  const changed: () => Promise<void> = async (): Promise<void> => { state.cacheCalls++; };
  return Object.assign(state, {
    updater, queue, accept: new UpdateDeploymentResourcesCase(uow, billing, updater, lock, undefined, changed),
    process: new ProcessDeploymentResourceUpdateCase(uow, billing, updater, lock, queue, changed), query: new GetDeploymentResourceUpdateCase(uow),
  });
}
async function claim(setup: Fixture, status: "APPLYING" | "RECONCILING" = "APPLYING", targetRevision: string | null = null): Promise<DeploymentResourceUpdate> {
  const receipt: DeploymentResourceUpdateReceipt = await setup.accept.exec(ID, "123", "key", BASELINE.version, REQUEST);
  const row: DeploymentResourceUpdate = new DeploymentResourceUpdate({ ...setup.commands.get(receipt.operationId)!.getDetails(), status, targetRevision, claimToken: TOKEN, claimExpiresAt: new Date(Date.now() + 120_000) });
  setup.commands.set(row.id, row); return row;
}

test("acceptance stores an immutable receipt, preserves applied image and uses no deployment-slot count", async (): Promise<void> => {
  const setup: Fixture = fixture(); const original: Deployment | null = setup.app;
  const receipt: DeploymentResourceUpdateReceipt = await setup.accept.exec(ID, "123", "key", '"version-1"', REQUEST);
  assert.equal(setup.commands.size, 1); assert.equal(setup.app?.image, original?.image); assert.equal(setup.app?.status, "RUNNING");
  assert.equal(setup.app?.activeResourceUpdateId, receipt.operationId); assert.equal(setup.writes, 0); assert.equal(setup.cacheCalls, 1);
  setup.products = [];
  assert.deepEqual(await setup.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), receipt);
  assert.equal(setup.billingCalls, 1);
  await assert.rejects(setup.accept.exec(ID, "123", "key", "other-version", REQUEST), DeploymentRequestKeyReused);
});

test("stale or missing version and another owner's ID never enqueue work", async (): Promise<void> => {
  const setup: Fixture = fixture();
  await assert.rejects(setup.accept.exec(ID, "123", "key", undefined, REQUEST), DeploymentResourceVersionRequired);
  await assert.rejects(setup.accept.exec(ID, "123", "key", "old-version", REQUEST), DeploymentResourceVersionMismatch);
  await assert.rejects(setup.accept.exec(ID, "foreign", "key", BASELINE.version, REQUEST), DeploymentNotFoundError);
  assert.equal(setup.commands.size, 0); assert.equal(setup.billingCalls, 0);
});

test("billing association and user eligibility are rechecked after external subscription verification", async (): Promise<void> => {
  const changes: Array<(setup: Fixture) => void> = [
    (setup: Fixture): void => { setup.user = new User({ ...setup.user!, suspended: true }); },
    (setup: Fixture): void => { setup.user = new User({ ...setup.user!, active: false }); },
    (setup: Fixture): void => { setup.user = new User({ ...setup.user!, stripeCustomerId: "cus_replaced" }); },
  ];
  for (let index: number = 0; index < changes.length; index++) {
    const setup: Fixture = fixture(); setup.afterBilling = (): void => changes[index]!(setup);
    await assert.rejects(setup.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), DeploymentSubscriptionRequired);
    assert.equal(setup.commands.size, 0);
  }
});

test("busy deployments, changed lifecycle, STOPPED apps and quotas fail before resource mutation", async (): Promise<void> => {
  const stopped: Fixture = fixture(); stopped.app = new Deployment({ ...stopped.app!.getDetails(), status: "STOPPED" });
  await assert.rejects(stopped.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && error.code === "RESOURCE_STOPPED_UNSUPPORTED");
  const changed: Fixture = fixture(); changed.afterBilling = (): void => { changed.app = new Deployment({ ...changed.app!.getDetails(), status: "STOPPING" }); };
  await assert.rejects(changed.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), (error: unknown): boolean => error instanceof DeploymentResourceUpdateError && error.code === "RESOURCE_DEPLOYMENT_CHANGED");
  const busy: Fixture = fixture(); await claim(busy);
  await assert.rejects(busy.accept.exec(ID, "123", "another-key", BASELINE.version, REQUEST), DeploymentOperationConflictError);
  const quota: Fixture = fixture(); quota.plans = [new Plan({ ...quota.plans[0]!, maxReplicas: 1 })];
  await assert.rejects(quota.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), DeploymentQuotaExceeded);
  assert.equal(quota.commands.size, 0);
});

test("pointer failure rolls the command and receipt back with the deployment", async (): Promise<void> => {
  const setup: Fixture = fixture(); setup.pointerFailure = true;
  await assert.rejects(setup.accept.exec(ID, "123", "key", BASELINE.version, REQUEST), /Injected pointer failure/);
  assert.equal(setup.commands.size, 0); assert.equal(setup.app?.activeResourceUpdateId, null); assert.equal(setup.cacheCalls, 0);
});

test("processing checkpoints before the sole write, finalizes verified success and exposes it through the query", async (): Promise<void> => {
  const setup: Fixture = fixture(); const row: DeploymentResourceUpdate = await claim(setup);
  await setup.process.exec(row);
  const result: DeploymentResourceUpdate = await setup.query.exec(ID, row.id, "123");
  assert.equal(result.status, "SUCCEEDED"); assert.deepEqual(result.observed, REQUEST); assert.equal(result.claimToken, null);
  assert.ok(result.completedAt); assert.equal(setup.app?.activeResourceUpdateId, null); assert.equal(setup.writes, 1);
  assert.equal(setup.app?.image, BASELINE.image);
  await assert.rejects(setup.query.exec(ID, row.id, "foreign"), DeploymentNotFoundError);
  await assert.rejects(setup.query.exec(ID, TOKEN, "123"), DeploymentResourceUpdateNotFound);
});

test("billing revoked after acceptance fails before Azure and releases only this command", async (): Promise<void> => {
  const setup: Fixture = fixture(); const row: DeploymentResourceUpdate = await claim(setup); setup.products = [];
  await setup.process.exec(row);
  assert.equal(setup.commands.get(row.id)?.status, "FAILED"); assert.equal(setup.writes, 0); assert.equal(setup.app?.activeResourceUpdateId, null);
});

test("lost Azure response retains the guard and reconciles instead of submitting the write again", async (): Promise<void> => {
  const setup: Fixture = fixture(); const row: DeploymentResourceUpdate = await claim(setup);
  setup.updater.update = async (input): ReturnType<DeploymentConfigurationUpdater["update"]> => {
    await input.onTargetRevision("app--target"); setup.writes++;
    throw new DeploymentResourceUpdateError("RESOURCE_WRITE_OUTCOME_UNKNOWN", "Lost response", true);
  };
  await setup.process.exec(row);
  assert.equal(setup.commands.get(row.id)?.status, "RECONCILING"); assert.equal(setup.app?.activeResourceUpdateId, row.id);
  const recovered: DeploymentResourceUpdate = new DeploymentResourceUpdate({ ...setup.commands.get(row.id)!.getDetails(), claimToken: TOKEN, claimExpiresAt: new Date(Date.now() + 120_000) });
  setup.commands.set(row.id, recovered); await setup.process.exec(recovered);
  assert.equal(setup.commands.get(row.id)?.status, "SUCCEEDED"); assert.equal(setup.writes, 1); assert.equal(setup.reconciles, 1);
});

test("unknown verification keeps the guard; a verified failed rollout releases it without claiming rollback", async (): Promise<void> => {
  const unknown: Fixture = fixture(); const waiting: DeploymentResourceUpdate = await claim(unknown, "RECONCILING", "app--target");
  unknown.reconcileResult = { outcome: "unknown", observed: REQUEST }; await unknown.process.exec(waiting);
  assert.equal(unknown.commands.get(waiting.id)?.status, "RECONCILING"); assert.equal(unknown.commands.get(waiting.id)?.claimToken, null);
  assert.equal(unknown.app?.activeResourceUpdateId, waiting.id); assert.equal(unknown.writes, 0);
  const failed: Fixture = fixture(); const rejected: DeploymentResourceUpdate = await claim(failed, "RECONCILING", "app--target");
  failed.reconcileResult = { outcome: "failed", observed: REQUEST, errorCode: "RESOURCE_REVISION_FAILED", errorMessage: "Rollout failed" };
  await failed.process.exec(rejected);
  assert.equal(failed.commands.get(rejected.id)?.status, "FAILED"); assert.equal(failed.app?.activeResourceUpdateId, null);
  assert.deepEqual(failed.commands.get(rejected.id)?.observed, REQUEST); assert.equal(failed.app?.image, BASELINE.image);
});

test("recovery without a target marker never calls Azure", async (): Promise<void> => {
  const setup: Fixture = fixture(); const row: DeploymentResourceUpdate = await claim(setup, "RECONCILING");
  await setup.process.exec(row);
  assert.equal(setup.commands.get(row.id)?.errorCode, "RESOURCE_WRITE_NOT_SUBMITTED"); assert.equal(setup.writes, 0); assert.equal(setup.reconciles, 0);
});

test("an old worker cannot finalize another claim or clear another operation's guard", async (): Promise<void> => {
  const setup: Fixture = fixture(); const row: DeploymentResourceUpdate = await claim(setup);
  const replacement: DeploymentResourceUpdate = new DeploymentResourceUpdate({ ...row.getDetails(), claimToken: "abcdef03-1234-4567-89ab-abcdef012345" });
  setup.commands.set(row.id, replacement); await setup.process.exec(row);
  assert.deepEqual(setup.commands.get(row.id)?.getDetails(), replacement.getDetails()); assert.equal(setup.writes, 0);
  assert.equal(setup.app?.activeResourceUpdateId, row.id);
});
