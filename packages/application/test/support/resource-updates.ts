import assert from "node:assert/strict";
import { Deployment, DeploymentResourceUpdate, Plan, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails, type DeploymentResourceUpdateDetails } from "@kumo/domain";
import { UpdateDeploymentResourcesCase, type DeploymentConfigurationUpdater, type DeploymentOperationLease, type DeploymentOperationLock, type DeploymentResourceUpdateProgress, type DeploymentResourceUpdateQueueRepository, type DeploymentResourceUpdateRepository, type UnitOfWorkRepositories } from "../../dist/index.js";
import { AdmissionFixture, SPEC } from "./admission.ts";

export const ID: string = "10000000-0000-4000-8000-000000000001";
export const REQUESTED: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 0, maxScaling: 3 };
export const BASELINE: DeploymentResourceBaseline = {
  configuration: { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 }, version: "cfg-test-v1",
  image: "registry.azurecr.io/my-app:old", mainContainerName: "my-app", revisionName: "my-app--old",
  resourceId: "/subscriptions/sub/resourceGroups/user-rg-123/providers/Microsoft.App/containerApps/my-app",
  environmentId: "/subscriptions/sub/resourceGroups/platform/providers/Microsoft.App/managedEnvironments/shared", revisionMode: "Single", runningStatus: "Running",
};

export function createUpdate(overrides: Partial<DeploymentResourceUpdateDetails> = {}): DeploymentResourceUpdate {
  const id: string = overrides.id ?? "20000000-0000-4000-8000-000000000001";
  const deploymentId: string = overrides.deploymentId ?? ID;
  const requested: DeploymentResourceConfigurationDetails = overrides.requested ?? REQUESTED;
  return new DeploymentResourceUpdate({
    id, deploymentId, userId: "123", keyHash: "a".repeat(64), fingerprint: "b".repeat(64), requested,
    baseline: BASELINE, lifecycle: "RUNNING", billingCustomerId: "cus_alice", status: "PENDING",
    claimToken: null, claimExpiresAt: null, heartbeatAt: null, targetRevision: null, observed: null,
    noOp: null, errorCode: null, errorMessage: null, createdAt: new Date(), startedAt: null, completedAt: null,
    ...overrides, receipt: { operationId: id, deploymentId, status: "PENDING", requested },
  });
}

export class ResourceAdmissionFixture extends AdmissionFixture {
  public updates: Map<string, DeploymentResourceUpdate> = new Map();
  public baseline: DeploymentResourceBaseline = BASELINE;
  public enabled: boolean = true;
  public applyCalls: number = 0;
  public reconcileCalls: number = 0;
  public unknownOutcome: boolean = false;
  public pointerFailure: boolean = false;
  private inTransaction: boolean = false;
  public readonly lock: DeploymentOperationLock = {
    leaseDurationMs: 30_000,
    acquire: async (deploymentId: string, operation: DeploymentOperationLease["operation"]): Promise<DeploymentOperationLease> => ({ deploymentId, operation, token: "test-lease" }),
    renew: async (): Promise<boolean> => true,
    release: async (): Promise<void> => {},
  };
  public readonly updater: DeploymentConfigurationUpdater = {
    get supportsStopped(): boolean { return true; },
    readBaseline: async (): Promise<DeploymentResourceBaseline> => { assert.equal(this.inTransaction, false); return this.baseline; },
    update: async (input: Parameters<DeploymentConfigurationUpdater["update"]>[0]): ReturnType<DeploymentConfigurationUpdater["update"]> => {
      assert.equal(this.inTransaction, false); this.applyCalls++;
      await input.onTargetRevision("my-app--resources");
      return { observed: input.requested, targetRevision: "my-app--resources", noOp: false };
    },
    reconcile: async (): ReturnType<DeploymentConfigurationUpdater["reconcile"]> => {
      assert.equal(this.inTransaction, false); this.reconcileCalls++;
      return this.unknownOutcome ? { outcome: "unknown" } : { outcome: "succeeded", observed: REQUESTED, targetRevision: "my-app--resources", noOp: false };
    },
  };
  public readonly repository: DeploymentResourceUpdateRepository = {
    findByIdAndUserId: async (id: string, userId: string): Promise<DeploymentResourceUpdate | null> => { const row: DeploymentResourceUpdate | undefined = this.updates.get(id); return row?.userId === userId ? row : null; },
    findByKeyHash: async (hash: string): Promise<DeploymentResourceUpdate | null> => [...this.updates.values()].find((row: DeploymentResourceUpdate): boolean => row.keyHash === hash) ?? null,
    findLatestByDeployment: async (id: string, userId: string): Promise<DeploymentResourceUpdate | null> => [...this.updates.values()].find((row: DeploymentResourceUpdate): boolean => row.deploymentId === id && row.userId === userId) ?? null,
    insert: async (row: DeploymentResourceUpdate): Promise<void> => { if (this.receiptFailure) throw new Error("Receipt persistence failed"); this.updates.set(row.id, row); },
  };
  public readonly queue: DeploymentResourceUpdateQueueRepository = {
    ...this.repository,
    claimNext: async (): Promise<null> => null,
    heartbeat: async (): Promise<boolean> => true,
    recoverStaleClaims: async (): Promise<number> => 0,
    updateClaimed: async (input: DeploymentResourceUpdateProgress): Promise<boolean> => {
      const row: DeploymentResourceUpdate | undefined = this.updates.get(input.operationId);
      if (!row || row.userId !== input.userId || row.claimToken !== input.claimToken || row.status !== input.expectedStatus) return false;
      const terminal: boolean = input.status === "SUCCEEDED" || input.status === "FAILED";
      this.updates.set(row.id, new DeploymentResourceUpdate({ ...row.getDetails(), status: input.status,
        targetRevision: input.targetRevision === undefined ? row.targetRevision : input.targetRevision,
        observed: input.observed === undefined ? row.observed : input.observed, noOp: input.noOp === undefined ? row.noOp : input.noOp,
        errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null, completedAt: terminal ? new Date() : null,
        claimToken: input.releaseClaim ? null : row.claimToken, claimExpiresAt: input.releaseClaim ? null : row.claimExpiresAt,
      }));
      if (terminal) this.deployments = this.deployments.map((app: Deployment): Deployment => app.activeResourceUpdateId === row.id ? new Deployment({ ...app.getDetails(), activeResourceUpdateId: null }) : app);
      return true;
    },
  };
  public readonly resourceCase: UpdateDeploymentResourcesCase = new UpdateDeploymentResourcesCase(this, this, this.updater, this.lock, (): boolean => this.enabled);

  public constructor() {
    super();
    this.plans = [new Plan({ ...this.plans[0]!, vcpu: 2, memory: 4, maxReplicas: 5, deployments: 1 })];
    this.deployments = [new Deployment({ id: ID, userId: "123", name: "my-app", spec: SPEC, status: "RUNNING", resourceId: BASELINE.resourceId, image: BASELINE.image })];
  }

  public override run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    return super.run(async (repo: UnitOfWorkRepositories): Promise<T> => {
      const before: Map<string, DeploymentResourceUpdate> = new Map(this.updates);
      this.inTransaction = true;
      try {
        return await work({ ...repo, deploymentResourceUpdates: this.repository, deployment: { ...repo.deployment,
          findByIdAndUserIdForUpdate: repo.deployment.findByIdAndUserId,
          setActiveResourceUpdate: async (id: string, userId: string, operationId: string): Promise<boolean> => {
            if (this.pointerFailure) throw new Error("Pointer persistence failed");
            const index: number = this.deployments.findIndex((app: Deployment): boolean => app.id === id && app.userId === userId && app.activeResourceUpdateId === null);
            if (index < 0) return false;
            this.deployments[index] = new Deployment({ ...this.deployments[index]!.getDetails(), activeResourceUpdateId: operationId }); return true;
          },
        } });
      } catch (error: unknown) { this.updates = before; throw error; }
      finally { this.inTransaction = false; }
    });
  }
}
