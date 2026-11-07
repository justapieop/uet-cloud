import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, Permission, Plan, Role, ScaleRule, User, type DeploymentStatus, type ScaleRuleDetails } from "@kumo/domain";
import { DeleteDeploymentCase, DeploymentNotFoundError, DeploymentOperationConflictError, DeploymentQuotaExceeded, EvaluateScaleRuleCase, ManageScaleRuleCase, ScaleRuleConflictError, VolumeOperationCoordinator, evaluateScaleRule, scaleRuleWindow,
  type DeploymentMetrics, type DeploymentScaler, type DeploymentScalingSnapshot, type ScaleDecision, type UnitOfWork, type UnitOfWorkRepositories } from "../dist/index.js";
import { emptyRepositories } from "./support/repositories.ts";

const NOW: Date = new Date("2026-11-07T10:10:30Z");
const OLD: Date = new Date("2026-11-07T09:00:00Z");
const RESOURCE_UPDATE_ID: string = "00000000-0000-4000-8000-000000000002";
const DETAILS: ScaleRuleDetails = {
  deploymentId: "00000000-0000-4000-8000-000000000001", enabled: true, metric: "cpu", scaleOutThreshold: 80, scaleInThreshold: 20,
  minReplicas: 1, maxReplicas: 4, evaluationWindowSeconds: 120, cooldownSeconds: 300,
  createdAt: OLD, updatedAt: OLD, lastEvaluatedAt: null, lastScaledAt: null, lastAction: "NO_ACTION", lastReason: "new",
};
const APP: Deployment = new Deployment({ id: DETAILS.deploymentId, userId: "123", name: "my-app", status: "RUNNING", resourceId: "/azure/app",
  createdAt: OLD, updatedAt: OLD, spec: { repo: "https://github.com/owner/repo", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 4 } });

function snapshot(count: number = 2): DeploymentScalingSnapshot {
  return { revisionName: "my-app--revision", replicaNames: Array.from({ length: count }, (_: unknown, index: number): string => `pod-${index}`), cpuCores: 0.5, memoryGiB: 1, revisionCreatedAt: OLD };
}

function metrics(value: number = 0.45, count: number = 2): DeploymentMetrics {
  const window: ReturnType<typeof scaleRuleWindow> = scaleRuleWindow(NOW, DETAILS.evaluationWindowSeconds);
  const times: string[] = [window.start.toISOString(), new Date(window.start.getTime() + 60_000).toISOString()];
  return { deploymentId: APP.id, intervalSeconds: 60, aggregation: "Average", cpuUnit: "cores", memoryUnit: "MiB", memory: [],
    cpu: snapshot(count).replicaNames.map((replicaName: string) => ({ revisionName: "my-app--revision", replicaName, points: times.map((timestamp: string) => ({ timestamp, value })) })),
    replicas: [{ revisionName: "my-app--revision", replicaName: null, points: times.map((timestamp: string) => ({ timestamp, value: count })) }],
  };
}

test("engine normalizes cores per allocated vCPU and requires a sustained high/low window", (): void => {
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), metrics(), NOW).action, "SCALE_OUT");
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), metrics(0.05), NOW).action, "SCALE_IN");
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), metrics(0.25), NOW).action, "NO_ACTION");
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), metrics(0.4), NOW).action, "NO_ACTION", "threshold equality does not scale");
  const spike: DeploymentMetrics = metrics();
  const mixed: DeploymentMetrics = { ...spike, cpu: spike.cpu.map((series) => ({ ...series, points: [series.points[0]!, { ...series.points[1]!, value: 0.25 }] })) };
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), mixed, NOW).action, "NO_ACTION");
});

test("engine enforces min/max, disabled, cooldown, and workflow states", (): void => {
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(4), metrics(0.45, 4), NOW).reason, "max_replicas");
  assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(1), metrics(0.05, 1), NOW).reason, "min_replicas");
  assert.equal(evaluateScaleRule({ ...DETAILS, enabled: false }, APP, snapshot(), metrics(), NOW).reason, "disabled");
  assert.equal(evaluateScaleRule({ ...DETAILS, lastScaledAt: new Date(NOW.getTime() - 60_000) }, APP, snapshot(), metrics(), NOW).reason, "cooldown");
  const statuses: readonly DeploymentStatus[] = ["PENDING", "PROVISIONING", "STOPPED", "STARTING", "STOPPING", "SCALING", "FAILED", "DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"];
  for (let index: number = 0; index < statuses.length; index++) {
    assert.equal(evaluateScaleRule(DETAILS, new Deployment({ ...APP.getDetails(), status: statuses[index]! }), snapshot(), metrics(), NOW).action, "NO_ACTION");
  }
});

test("engine fails safe on missing, stale, null, nonfinite, duplicate, partial, or unstable telemetry", (): void => {
  const valid: DeploymentMetrics = metrics();
  const bad: readonly (DeploymentMetrics | null)[] = [null, { ...valid, cpu: [] }, { ...valid, replicas: [] },
    { ...valid, cpu: valid.cpu.map((series) => ({ ...series, points: series.points.slice(1) })) },
    { ...valid, cpu: valid.cpu.map((series) => ({ ...series, points: series.points.map((point) => ({ ...point, timestamp: OLD.toISOString() })) })) },
    ...[null, NaN, Infinity, -1, Number.MAX_VALUE].map((value: number | null): DeploymentMetrics => ({ ...valid, cpu: valid.cpu.map((series) => ({ ...series, points: series.points.map((point) => ({ ...point, value })) })) })),
    { ...valid, cpu: [valid.cpu[0]!, valid.cpu[0]!] },
    { ...valid, cpu: valid.cpu.map((series) => ({ ...series, points: [...series.points, series.points[0]!] })) },
    { ...valid, replicas: valid.replicas.map((series) => ({ ...series, points: series.points.map((point) => ({ ...point, value: 1.5 })) })) },
  ];
  for (let index: number = 0; index < bad.length; index++) assert.equal(evaluateScaleRule(DETAILS, APP, snapshot(), bad[index]!, NOW).action, "NO_ACTION");
  assert.equal(evaluateScaleRule(DETAILS, APP, { ...snapshot(), revisionCreatedAt: NOW }, valid, NOW).reason, "warming_up");
  assert.equal(evaluateScaleRule(DETAILS, APP, { ...snapshot(), revisionName: "new-revision" }, valid, NOW).action, "NO_ACTION");
});

class Fixture implements UnitOfWork {
  public deployment: Deployment = APP;
  public rule: ScaleRule | null = new ScaleRule(DETAILS);
  public user: User = new User({ id: "123", displayName: "Alice", suspended: false, stripeCustomerId: "cus_alice" });
  public plan: Plan = new Plan({ id: "plan", name: "Plan", vcpu: 0.5, memory: 1, deployments: 1, disk: 32, maxReplicas: 4, stripeProductId: "prod_plan", price: 5 });
  public roles: Role[] = [new Role({ id: "super", name: "Super", permission: 1n << BigInt(Permission.Super.offset) })];
  public locked: boolean = false;
  public inTransaction: boolean = false;
  public scaleCalls: number = 0;
  public inspectCalls: number = 0;
  public metricsCalls: number = 0;
  public metricValue: number = 0.45;
  public expectedTarget: number = 3;
  public stripeCalls: number = 0;
  public providerFailure: boolean = false;
  public monitoringFailure: boolean = false;
  public stripeFailure: boolean = false;
  public beforeClaim: (() => void) | null = null;
  public scalingGate: Promise<void> = Promise.resolve();
  public readonly lock: VolumeOperationCoordinator = new VolumeOperationCoordinator();
  public readonly scaler: DeploymentScaler = {
    inspect: async (): Promise<DeploymentScalingSnapshot> => { assert.equal(this.inTransaction, false); this.inspectCalls++; return snapshot(); },
    scale: async (input): Promise<void> => {
      assert.equal(this.inTransaction, false); assert.equal(this.deployment.status, "SCALING"); assert.equal(input.targetReplicas, this.expectedTarget);
      this.scaleCalls++; await this.scalingGate;
      if (this.providerFailure) throw new Error("secret provider payload");
    },
  };
  public readonly subscriptions: { getActiveSubscriptionProductIds: () => Promise<readonly string[]> } = {
    getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => {
      assert.equal(this.inTransaction, false); this.stripeCalls++;
      if (this.stripeFailure) throw new Error("Stripe failed");
      this.beforeClaim?.();
      return ["prod_plan"];
    },
  };
  public readonly evaluator: EvaluateScaleRuleCase = new EvaluateScaleRuleCase(this, this.subscriptions, {
    read: async (): Promise<DeploymentMetrics> => { assert.equal(this.inTransaction, false); this.metricsCalls++; if (this.monitoringFailure) throw new Error("Monitor unavailable"); return metrics(this.metricValue); },
  }, this.scaler, this.lock, (): Date => NOW);
  public readonly manager: ManageScaleRuleCase = new ManageScaleRuleCase(this, this.subscriptions, this.lock);

  public async run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    assert.equal(this.inTransaction, false);
    const beforeDeployment: Deployment = this.deployment;
    const beforeRule: ScaleRule | null = this.rule;
    this.inTransaction = true; this.locked = false;
    const repo: UnitOfWorkRepositories = {
      ...emptyRepositories(),
      users: { ...emptyRepositories().users, findById: async (): Promise<User> => this.user, findByIdForUpdate: async (): Promise<User> => { this.locked = true; return this.user; } },
      roles: { ...emptyRepositories().roles, findActiveByUserId: async (): Promise<Role[]> => this.roles },
      plans: { findActiveByStripeProductIds: async (): Promise<Plan[]> => [this.plan] },
      deployment: { ...emptyRepositories().deployment,
        findById: async (): Promise<Deployment> => this.deployment,
        findByIdAndUserId: async (id: string, userId: string): Promise<Deployment | null> => id === this.deployment.id && userId === this.deployment.userId ? this.deployment : null,
        countReservedByUserId: async (): Promise<number> => { assert.equal(this.locked, true); return 1; },
        transitionStatus: async (_id: string, _userId: string, from: DeploymentStatus, to: DeploymentStatus): Promise<boolean> => {
          if (this.deployment.status !== from) return false;
          this.deployment = new Deployment({ ...this.deployment.getDetails(), status: to }); return true;
        },
        updateProgress: async (deployment, options): Promise<void> => { assert.equal(this.deployment.status, options?.expectedStatus); this.deployment = deployment; },
      },
      scaleRules: { findByDeploymentId: async (): Promise<ScaleRule | null> => this.rule, save: async (rule: ScaleRule): Promise<void> => { this.rule = rule; }, delete: async (): Promise<void> => { this.rule = null; } },
    };
    try { return await work(repo); }
    catch (error: unknown) { this.deployment = beforeDeployment; this.rule = beforeRule; throw error; }
    finally { this.inTransaction = false; }
  }
}

test("management persists CRUD, rejects other owners, and disables/deletes without a subscription", async (): Promise<void> => {
  const fixture: Fixture = new Fixture(); fixture.rule = null;
  const saved: ScaleRule = await fixture.manager.save(APP.id, "123", DETAILS, true);
  assert.equal(saved.getDetails().deploymentId, APP.id);
  await assert.rejects(fixture.manager.save(APP.id, "123", DETAILS, true), ScaleRuleConflictError);
  await assert.rejects(fixture.manager.get(APP.id, "456"), DeploymentNotFoundError);
  await assert.rejects(fixture.manager.save(APP.id, "456", { enabled: false }, false), DeploymentNotFoundError);
  await assert.rejects(fixture.manager.delete(APP.id, "456"), DeploymentNotFoundError);
  assert.equal((await fixture.manager.list(APP.id, "123")).length, 1);
  fixture.stripeFailure = true;
  const disabled: ScaleRule = await fixture.manager.save(APP.id, "123", { enabled: false }, false);
  assert.equal(disabled.getDetails().enabled, false);
  await fixture.manager.delete(APP.id, "123");
  assert.deepEqual(await fixture.manager.list(APP.id, "123"), []);
});

test("pending resource updates block scale-rule mutations before subscription reads", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  fixture.deployment = new Deployment({ ...APP.getDetails(), activeResourceUpdateId: RESOURCE_UPDATE_ID });
  const original: ScaleRule | null = fixture.rule;
  await assert.rejects(fixture.manager.save(APP.id, "123", { scaleOutThreshold: 90 }, false), DeploymentOperationConflictError);
  await assert.rejects(fixture.manager.save(APP.id, "123", { enabled: false }, false), DeploymentOperationConflictError);
  await assert.rejects(fixture.manager.delete(APP.id, "123"), DeploymentOperationConflictError);
  assert.equal(fixture.rule, original);
  assert.equal(await fixture.manager.get(APP.id, "123"), original, "read access remains available");
  fixture.rule = null;
  await assert.rejects(fixture.manager.save(APP.id, "123", DETAILS, true), DeploymentOperationConflictError);
  assert.equal(fixture.rule, null);
  assert.equal(fixture.stripeCalls, 0);
  assert.equal(fixture.deployment.activeResourceUpdateId, RESOURCE_UPDATE_ID);
});

test("scale-rule acceptance rechecks resource updates after subscription lookup", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  const original: ScaleRule | null = fixture.rule;
  fixture.beforeClaim = (): void => {
    fixture.deployment = new Deployment({ ...APP.getDetails(), activeResourceUpdateId: RESOURCE_UPDATE_ID });
  };
  await assert.rejects(fixture.manager.save(APP.id, "123", { scaleOutThreshold: 90 }, false), DeploymentOperationConflictError);
  assert.equal(fixture.rule, original);
  assert.equal(fixture.stripeCalls, 1);
  assert.equal(fixture.deployment.activeResourceUpdateId, RESOURCE_UPDATE_ID);
});

test("pending resource updates skip scaling and external reads", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  fixture.deployment = new Deployment({ ...APP.getDetails(), activeResourceUpdateId: RESOURCE_UPDATE_ID });
  const original: ScaleRule | null = fixture.rule;
  assert.equal((await fixture.evaluator.exec(APP.id)).action, "NO_ACTION");
  assert.equal(fixture.inspectCalls, 0);
  assert.equal(fixture.metricsCalls, 0);
  assert.equal(fixture.stripeCalls, 0);
  assert.equal(fixture.scaleCalls, 0);
  assert.equal(fixture.rule, original);
  assert.equal(fixture.deployment.status, "RUNNING");
  assert.equal(fixture.deployment.activeResourceUpdateId, RESOURCE_UPDATE_ID);
});

test("scaling rechecks pending resource updates before claiming the deployment", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  fixture.beforeClaim = (): void => {
    fixture.deployment = new Deployment({ ...APP.getDetails(), activeResourceUpdateId: RESOURCE_UPDATE_ID });
  };
  assert.equal((await fixture.evaluator.exec(APP.id)).reason, "deployment_changed");
  assert.equal(fixture.inspectCalls, 1);
  assert.equal(fixture.metricsCalls, 1);
  assert.equal(fixture.stripeCalls, 1);
  assert.equal(fixture.scaleCalls, 0);
  assert.equal(fixture.rule?.getDetails().lastScaledAt, null);
  assert.equal(fixture.deployment.status, "RUNNING");
  assert.equal(fixture.deployment.activeResourceUpdateId, RESOURCE_UPDATE_ID);
});

test("rule bounds and a single current plan must cover the saved reservation", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  await assert.rejects(fixture.manager.save(APP.id, "123", { maxReplicas: 5 }, false), DeploymentQuotaExceeded);
  fixture.plan = new Plan({ ...fixture.plan, maxReplicas: 2 });
  await assert.rejects(fixture.manager.save(APP.id, "123", { enabled: true }, false), DeploymentQuotaExceeded);
  assert.equal((await fixture.evaluator.exec(APP.id)).reason, "quota_exceeded");
  assert.equal(fixture.scaleCalls, 0);
});

test("evaluation confirms provider completion before cooldown and RUNNING are persisted", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  assert.equal((await fixture.evaluator.exec(APP.id)).action, "SCALE_OUT");
  assert.equal(fixture.scaleCalls, 1); assert.equal(fixture.deployment.status, "RUNNING");
  assert.equal(fixture.rule?.getDetails().lastScaledAt?.getTime(), NOW.getTime());
  assert.equal((await fixture.evaluator.exec(APP.id)).reason, "cooldown");
  assert.equal(fixture.scaleCalls, 1); assert.equal(fixture.metricsCalls, 1);
});

test("provider failure is sanitized, blocks repeated writes, and never advances successful cooldown", async (): Promise<void> => {
  const fixture: Fixture = new Fixture(); fixture.providerFailure = true;
  assert.equal((await fixture.evaluator.exec(APP.id)).reason, "scaling_failed_or_unconfirmed");
  assert.equal(fixture.rule?.getDetails().lastScaledAt, null);
  assert.equal(fixture.deployment.status, "FAILED");
  assert.doesNotMatch(fixture.deployment.error!, /secret/);
  await fixture.evaluator.exec(APP.id); assert.equal(fixture.scaleCalls, 1);
});

test("low CPU executes scale-in through the same guarded provider path", async (): Promise<void> => {
  const fixture: Fixture = new Fixture(); fixture.metricValue = 0.05; fixture.expectedTarget = 1;
  assert.equal((await fixture.evaluator.exec(APP.id)).action, "SCALE_IN");
  assert.equal(fixture.scaleCalls, 1); assert.equal(fixture.rule?.getDetails().lastAction, "SCALE_IN");
});

test("two evaluator instances share the deployment lease and exclude mutations during scaling", { timeout: 5000 }, async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  let release: () => void = (): void => {};
  fixture.scalingGate = new Promise<void>((resolve: () => void): void => { release = resolve; });
  const first: Promise<ScaleDecision> = fixture.evaluator.exec(APP.id);
  while (fixture.scaleCalls === 0) await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); });
  const other: EvaluateScaleRuleCase = new EvaluateScaleRuleCase(fixture, fixture.subscriptions,
    { read: async (): Promise<never> => { throw new Error("A competing instance must not read metrics"); } }, fixture.scaler, fixture.lock, (): Date => NOW);
  assert.equal((await other.exec(APP.id)).reason, "operation_in_progress");
  await assert.rejects(fixture.manager.save(APP.id, "123", { enabled: false }, false), DeploymentOperationConflictError);
  release(); await first; assert.equal(fixture.scaleCalls, 1);
});

test("no rule, disabled, suspended, revoked permissions, Stripe outage, and competing lifecycle all fail safe", async (): Promise<void> => {
  const empty: Fixture = new Fixture(); empty.rule = null; await empty.evaluator.exec(APP.id); assert.equal(empty.metricsCalls, 0);
  const disabled: Fixture = new Fixture(); disabled.rule = new ScaleRule({ ...DETAILS, enabled: false }); await disabled.evaluator.exec(APP.id); assert.equal(disabled.scaleCalls, 0);
  const suspended: Fixture = new Fixture(); suspended.user = new User({ ...suspended.user, suspended: true }); await suspended.evaluator.exec(APP.id); assert.equal(suspended.metricsCalls, 0);
  const revoked: Fixture = new Fixture(); revoked.roles = []; await revoked.evaluator.exec(APP.id); assert.equal(revoked.metricsCalls, 0);
  const stripe: Fixture = new Fixture(); stripe.stripeFailure = true; await stripe.evaluator.exec(APP.id); assert.equal(stripe.scaleCalls, 0);
  const monitoring: Fixture = new Fixture(); monitoring.monitoringFailure = true;
  assert.equal((await monitoring.evaluator.exec(APP.id)).reason, "monitoring_or_capacity_unavailable");
  assert.equal(monitoring.scaleCalls, 0); assert.equal(monitoring.deployment.status, "RUNNING");
  const busy: Fixture = new Fixture(); busy.beforeClaim = (): void => { busy.deployment = new Deployment({ ...APP.getDetails(), status: "STOPPING" }); };
  assert.equal((await busy.evaluator.exec(APP.id)).reason, "deployment_changed"); assert.equal(busy.scaleCalls, 0);
});

test("deployment deletion removes its rule atomically", async (): Promise<void> => {
  const fixture: Fixture = new Fixture();
  await new DeleteDeploymentCase(fixture, fixture.lock).exec({ id: APP.id, userId: "123" });
  assert.equal(fixture.rule, null); assert.equal(fixture.deployment.status, "DELETE_PENDING");
});
