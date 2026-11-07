import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Logger, Module, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DeploymentResourceUpdate, type DeploymentResourceConfigurationDetails } from "@kumo/domain";
import type { DeploymentResourceUpdateQueueRepository } from "@kumo/application";
import { DeploymentResourceUpdateWorker } from "../dist/azure/deployment-resource-update-worker.js";

const ID: string = "abcdef01-1234-4567-89ab-abcdef012345";
const DEPLOYMENT: string = "abcdef02-1234-4567-89ab-abcdef012345";
const CONFIG: DeploymentResourceConfigurationDetails = { maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 };
function command(status: "APPLYING" | "RECONCILING" = "APPLYING"): DeploymentResourceUpdate {
  return new DeploymentResourceUpdate({ id: ID, deploymentId: DEPLOYMENT, userId: "123", keyHash: "a".repeat(64), fingerprint: "b".repeat(64),
    requested: CONFIG, baseline: { configuration: CONFIG, version: "v1", image: "registry/app:commit", mainContainerName: "app", revisionName: "app--old", resourceId: "/apps/app", environmentId: "/environments/shared", revisionMode: "Single", runningStatus: "Running" },
    lifecycle: "RUNNING", billingCustomerId: "cus_owner", status, claimToken: "abcdef03-1234-4567-89ab-abcdef012345", claimExpiresAt: new Date(Date.now() + 120_000),
    heartbeatAt: new Date(), targetRevision: "app--target", observed: null, noOp: null, errorCode: null, errorMessage: null,
    receipt: { operationId: ID, deploymentId: DEPLOYMENT, status: "PENDING", requested: CONFIG }, createdAt: new Date(), startedAt: new Date(), completedAt: null });
}
function queue(row: DeploymentResourceUpdate | null, events: string[] = []): DeploymentResourceUpdateQueueRepository {
  let current: DeploymentResourceUpdate | null = row;
  let claimed: boolean = false;
  return {
    findByIdAndUserId: async (): Promise<DeploymentResourceUpdate | null> => current,
    findByKeyHash: async (): Promise<DeploymentResourceUpdate | null> => current,
    findLatestByDeployment: async (): Promise<DeploymentResourceUpdate | null> => current,
    insert: async (): Promise<never> => { throw new Error("Worker cannot accept a new command"); },
    claimNext: async (): Promise<DeploymentResourceUpdate | null> => { events.push("claim"); if (claimed) return null; claimed = true; return current; },
    heartbeat: async (): Promise<boolean> => { events.push("heartbeat"); return true; },
    recoverStaleClaims: async (): Promise<number> => { events.push("sweep"); return 0; },
    updateClaimed: async (input: Parameters<DeploymentResourceUpdateQueueRepository["updateClaimed"]>[0]): Promise<boolean> => {
      if (!current || current.claimToken !== input.claimToken || current.status !== input.expectedStatus) return false;
      events.push(`persist:${input.status}`);
      const terminal: boolean = input.status === "SUCCEEDED" || input.status === "FAILED";
      current = new DeploymentResourceUpdate({ ...current.getDetails(), status: input.status,
        completedAt: terminal ? new Date() : null, observed: input.observed ?? current.observed,
        claimToken: terminal || input.releaseClaim ? null : current.claimToken,
        claimExpiresAt: terminal || input.releaseClaim ? null : current.claimExpiresAt,
      });
      return true;
    },
  };
}
async function flush(): Promise<void> { await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); }); }
async function application(worker: DeploymentResourceUpdateWorker, events: string[]): Promise<INestApplicationContext> {
  class SqlShutdown {
    public onApplicationShutdown(): void { events.push("sql-close"); }
  }
  class FixtureModule {}
  Module({ providers: [{ provide: DeploymentResourceUpdateWorker, useValue: worker }, SqlShutdown] })(FixtureModule);
  return NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
}

test("shutdown cancels active Azure waiting and persists reconciliation before SQL shutdown", { timeout: 5000 }, async (): Promise<void> => {
  const events: string[] = []; const repository: DeploymentResourceUpdateQueueRepository = queue(command(), events);
  let signal: AbortSignal | undefined; let release: () => void = (): void => {};
  const worker: DeploymentResourceUpdateWorker = new DeploymentResourceUpdateWorker(repository, {
    exec: async (_row: DeploymentResourceUpdate, abort?: AbortSignal): Promise<void> => {
      signal = abort;
      await new Promise<void>((resolve: () => void, reject: (reason: unknown) => void): void => {
        release = (): void => reject(new Error("test cleanup"));
        abort?.addEventListener("abort", (): void => reject(abort.reason), { once: true });
      });
    },
  }, new ConfigService());
  const app: INestApplicationContext = await application(worker, events); await flush();
  const stopping: Promise<void> = app.close(); await flush();
  try { assert.equal(signal?.aborted, true, "shutdown must cancel the old worker instead of renewing a claim for an hour"); }
  finally { release(); await stopping; }
  assert.ok(events.indexOf("persist:RECONCILING") < events.indexOf("sql-close"));
  assert.equal((await repository.findByIdAndUserId(ID, "123"))?.claimToken, null);
});

test("shutdown during a SQL claim aborts the newly returned work before it can submit Azure changes", { timeout: 5000 }, async (): Promise<void> => {
  let resolveClaim: (value: DeploymentResourceUpdate) => void = (): void => {};
  const claiming: Promise<DeploymentResourceUpdate> = new Promise<DeploymentResourceUpdate>((resolve: (value: DeploymentResourceUpdate) => void): void => { resolveClaim = resolve; });
  const repository: DeploymentResourceUpdateQueueRepository = { ...queue(command()), claimNext: async (): Promise<DeploymentResourceUpdate> => claiming };
  let alreadyAborted: boolean = false;
  const worker: DeploymentResourceUpdateWorker = new DeploymentResourceUpdateWorker(repository, {
    exec: async (_row: DeploymentResourceUpdate, signal?: AbortSignal): Promise<void> => { alreadyAborted = signal?.aborted === true; signal?.throwIfAborted(); },
  }, new ConfigService());
  const app: INestApplicationContext = await application(worker, []); await flush();
  const stopping: Promise<void> = app.close(); await flush(); resolveClaim(command()); await stopping;
  assert.equal(alreadyAborted, true);
});

test("cache invalidation failure does not block reconciliation of a ready Azure revision", async (context: TestContext): Promise<void> => {
  context.mock.method(Logger.prototype, "warn", (): void => {});
  const row: DeploymentResourceUpdate = command("RECONCILING"); const repository: DeploymentResourceUpdateQueueRepository = queue(row);
  let processed: number = 0;
  const worker: DeploymentResourceUpdateWorker = new DeploymentResourceUpdateWorker(repository, {
    exec: async (): Promise<void> => { processed++; await repository.updateClaimed({ operationId: row.id, userId: row.userId, claimToken: row.claimToken!, expectedStatus: "RECONCILING", status: "SUCCEEDED", observed: CONFIG }); },
  }, new ConfigService(), async (): Promise<never> => { throw new Error("Redis unavailable"); });
  const app: INestApplicationContext = await application(worker, []); await flush(); await app.close();
  assert.equal(processed, 1); assert.equal((await repository.findByIdAndUserId(ID, "123"))?.status, "SUCCEEDED");
});

test("lost heartbeat aborts processing and a stale token cannot finalize a replacement claim", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const row: DeploymentResourceUpdate = command(); const repository: DeploymentResourceUpdateQueueRepository = { ...queue(row), heartbeat: async (): Promise<boolean> => false };
  let seen: AbortSignal | undefined;
  const worker: DeploymentResourceUpdateWorker = new DeploymentResourceUpdateWorker(repository, {
    exec: async (_row: DeploymentResourceUpdate, signal?: AbortSignal): Promise<void> => {
      seen = signal;
      await new Promise<never>((_resolve: (value: never) => void, reject: (reason: unknown) => void): void => { signal?.addEventListener("abort", (): void => reject(signal.reason), { once: true }); });
    },
  }, new ConfigService());
  const app: INestApplicationContext = await application(worker, []); await flush(); context.mock.timers.tick(40_000); await flush(); await app.close();
  assert.equal(seen?.aborted, true);
  assert.equal((await repository.findByIdAndUserId(ID, "123"))?.status, "RECONCILING");
  assert.equal(await repository.updateClaimed({ operationId: ID, userId: "123", claimToken: row.claimToken!, expectedStatus: "APPLYING", status: "SUCCEEDED" }), false);
});

test("idle workers back off claims, sweep once per minute and stop polling after shutdown", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 }); context.mock.method(Math, "random", (): number => 0.5);
  const events: string[] = []; const repository: DeploymentResourceUpdateQueueRepository = queue(null, events);
  const worker: DeploymentResourceUpdateWorker = new DeploymentResourceUpdateWorker(repository, { exec: async (): Promise<never> => { throw new Error("No work expected"); } }, new ConfigService());
  const app: INestApplicationContext = await application(worker, events); await flush();
  for (let index: number = 0; index < 120; index++) { context.mock.timers.tick(1000); await flush(); }
  assert.equal(events.filter((event: string): boolean => event === "sweep").length, 3);
  assert.ok(events.filter((event: string): boolean => event === "claim").length <= 16);
  await app.close(); const count: number = events.length; context.mock.timers.tick(60_000); await flush(); assert.equal(events.length, count);
});
