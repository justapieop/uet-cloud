import assert from "node:assert/strict";
import { registerHooks, type ResolveHookSync } from "node:module";
import { beforeEach, test } from "node:test";
import type { Deployment } from "../../../entities/deployment/model/types.ts";
import type { ComputeConfiguration } from "../../../entities/deployment/model/compute-configuration.ts";
import type { Plan } from "../../../entities/plan/model/types.ts";

// Resolve the existing FSD public import without loading unrelated UI modules.
const resolve: ResolveHookSync = (specifier, context, nextResolve) => specifier === "@/entities/deployment"
  ? { url: new URL("../../../entities/deployment/model/compute-configuration.ts", import.meta.url).href, shortCircuit: true }
  : nextResolve(specifier, context);
registerHooks({ resolve });
const logic: typeof import("./deployment-spec.ts") = await import("./deployment-spec.ts");
const sessions: typeof import("./resource-update-session.ts") = await import("./resource-update-session.ts");
const ID: string = "abcdef01-1234-4567-89ab-abcdef012345";
const CONFIG: ComputeConfiguration = { max_vcpu: 0.5, max_memory: 1, min_scaling: 0, max_scaling: 2 };
const DEPLOYMENT: Deployment = {
  id: ID, name: "app", status: "RUNNING", resource_id: "/apps/app", configuration_version: "v1",
  resource_update: null, region: "eastasia", target_port: 8080, additional_ports: [], volumes: [], external: true,
  image: "registry/app:commit", build_id: null, fqdn: null, error: null, ...CONFIG,
  created_at: "2026-11-08T00:00:00Z", updated_at: "2026-11-08T00:00:00Z",
};
const PLAN: Plan = { id: "plan", name: "Plan", price: 5, vcpu: 1, memory: 2, max_replicas: 3, deployments: 1, disk: 32 };
const storage: Map<string, string> = new Map<string, string>();
beforeEach((): void => {
  storage.clear();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
    removeItem: (key: string): void => { storage.delete(key); },
  } });
});

test("edit opens only for a running provisioned deployment with a stable applied configuration", (): void => {
  assert.equal(logic.getDeploymentEditUnavailableReason(DEPLOYMENT), null);
  const states: Deployment["status"][] = ["PENDING", "PROVISIONING", "STARTING", "STOPPING", "STOPPED", "FAILED", "DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"];
  for (let index: number = 0; index < states.length; index++) assert.ok(logic.getDeploymentEditUnavailableReason({ ...DEPLOYMENT, status: states[index]! }));
  assert.ok(logic.getDeploymentEditUnavailableReason({ ...DEPLOYMENT, resource_id: null }));
  assert.ok(logic.getDeploymentEditUnavailableReason({ ...DEPLOYMENT, configuration_version: null }));
});

test("invalid applied compute cannot open the editor even when a version is present", (): void => {
  const patches: Partial<ComputeConfiguration>[] = [{ max_memory: 3 }, { max_vcpu: 0.3, max_memory: 0.6 }, { min_scaling: -1 }, { max_scaling: 0 }, { min_scaling: 3 }, { max_vcpu: Number.NaN }];
  for (let index: number = 0; index < patches.length; index++) {
    const deployment: Deployment = { ...DEPLOYMENT, ...patches[index] };
    assert.equal(logic.getDeploymentComputeConfiguration(deployment), null, JSON.stringify(patches[index]));
    assert.ok(logic.getDeploymentEditUnavailableReason(deployment));
  }
});

test("zero minimum replicas remains valid and one plan must cover every quota dimension", (): void => {
  assert.deepEqual(logic.getDeploymentComputeConfiguration(DEPLOYMENT), CONFIG);
  assert.equal(logic.configurationFitsPlan(CONFIG, [PLAN]), true);
  assert.equal(logic.configurationFitsPlan(CONFIG, []), false);
  assert.equal(logic.configurationFitsPlan({ ...CONFIG, max_scaling: 4 }, [PLAN, { ...PLAN, id: "scale", vcpu: 0.25, memory: 0.5, max_replicas: 10 }]), false);
  assert.equal(logic.configurationFitsPlan({ ...CONFIG, max_memory: 5 }, [PLAN]), false);
});

test("only pending, applying and reconciling operations are active", (): void => {
  const active: Array<"PENDING" | "APPLYING" | "RECONCILING"> = ["PENDING", "APPLYING", "RECONCILING"];
  for (let index: number = 0; index < active.length; index++) assert.equal(logic.isResourceUpdateActive({ status: active[index]! }), true);
  assert.equal(logic.isResourceUpdateActive({ status: "SUCCEEDED" }), false);
  assert.equal(logic.isResourceUpdateActive({ status: "FAILED" }), false);
  assert.equal(logic.isResourceUpdateActive(null), false);
});

test("saved retries retain the exact key, version and configuration and are scoped to their deployment", (): void => {
  const session: import("./resource-update-session.ts").ResourceUpdateSession = { key: "retry-key", version: "v1", configuration: CONFIG, operationId: ID };
  sessions.saveResourceUpdateSession(ID, session);
  assert.deepEqual(sessions.readResourceUpdateSession(ID), session);
  assert.equal(sessions.readResourceUpdateSession("other"), null);
  sessions.clearResourceUpdateSession(ID);
  assert.equal(sessions.readResourceUpdateSession(ID), null);
});

test("corrupt or malformed saved operation IDs cannot restore an unpollable update", (): void => {
  const malformed: unknown[] = ["-".repeat(36), "a".repeat(36), "abcdef01_1234_4567_89ab_abcdef012345", 42];
  for (let index: number = 0; index < malformed.length; index++) {
    storage.set(`kumo:resource-update:${ID}`, JSON.stringify({ key: "key", version: "v1", configuration: CONFIG, operationId: malformed[index] }));
    assert.equal(sessions.readResourceUpdateSession(ID), null, String(malformed[index]));
  }
  storage.set(`kumo:resource-update:${ID}`, "{broken");
  assert.equal(sessions.readResourceUpdateSession(ID), null);
});

test("an unconfirmed submission restores its retry key without inventing an operation ID", (): void => {
  sessions.saveResourceUpdateSession(ID, { key: "same-key", version: "v1", configuration: CONFIG, operationId: null });
  assert.equal(sessions.readResourceUpdateSession(ID)?.operationId, null);
  assert.equal(sessions.readResourceUpdateSession(ID)?.key, "same-key");
});

test("saved retries with an invalid configuration version cannot restore an unrecoverable request", (): void => {
  const invalid: string[] = ["*", "W/v1", "v1,v2", "bad\nversion", " "];
  for (let index: number = 0; index < invalid.length; index++) {
    storage.set(`kumo:resource-update:${ID}`, JSON.stringify({ key: "key", version: invalid[index], configuration: CONFIG, operationId: null }));
    assert.equal(sessions.readResourceUpdateSession(ID), null, invalid[index]);
  }
});

test("unavailable storage never throws and upstream failures retain uncertainty without leaking raw error messages", (): void => {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: (): never => { throw new Error("storage denied"); } });
  assert.equal(sessions.readResourceUpdateSession(ID), null);
  assert.doesNotThrow((): void => sessions.saveResourceUpdateSession(ID, { key: "key", version: "v1", configuration: CONFIG, operationId: null }));
  assert.doesNotThrow((): void => sessions.clearResourceUpdateSession(ID));
  const error: ReturnType<typeof logic.resourceUpdateRequestError> = logic.resourceUpdateRequestError(503, { message: "private upstream payload", code: "INTERNAL_SECRET" });
  assert.equal(error.outcomeUnknown, true);
  assert.equal(error.code, null);
  assert.doesNotMatch(error.message, /private|payload|secret/i);
  assert.equal(logic.resourceUpdateRequestError(412, null).outcomeUnknown, false);
});
