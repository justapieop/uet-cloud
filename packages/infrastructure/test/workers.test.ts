import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { Build, Deployment, type BuildDetails } from "@kumo/domain";
import type { BuildQueueRepository, DeploymentQueueRepository } from "@kumo/application";
import { DeploymentWorker } from "../dist/azure/deployment-worker.js";
import { BuildWorker } from "../dist/azure/build-worker.js";
import { emptyRepositories } from "../../application/test/support/repositories.ts";

const CLAIMED: Deployment = new Deployment({ id: "deployment", userId: "123", name: "my-app", status: "PROVISIONING", spec: { repo: "https://github.com/owner/repo", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 } });
const BUILD: BuildDetails = { id: "build", userId: "123", repo: "https://github.com/owner/repo", ref: null, error: null, dockerFilePath: "Dockerfile", commitSha: null, image: "registry/app:v1", status: "PREPARING", runId: null, runUrl: null, sourceTokenHash: "a".repeat(64), sourceExpiresAt: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date() };

async function flush(): Promise<void> { await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); }); }

test("idle deployment workers back off SQL claims and sweep once a minute", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  context.mock.method(Math, "random", (): number => 0.5);
  let claims: number = 0;
  let sweeps: number = 0;
  const worker: DeploymentWorker = new DeploymentWorker({ ...emptyRepositories().deployment,
    claimNextPending: async (): Promise<null> => { claims++; return null; },
    failStaleProvisioning: async (): Promise<void> => { sweeps++; },
  }, { exec: async (): Promise<never> => { throw new Error("Idle worker must not process work"); } }, new ConfigService());
  worker.onApplicationBootstrap(); await flush();
  for (let second: number = 0; second < 120; second++) { context.mock.timers.tick(1000); await flush(); }
  assert.ok(claims <= 16, `Expected backed-off claims, got ${claims}`);
  assert.equal(sweeps, 3);
  await worker.onApplicationShutdown();
});

test("deployment worker avoids overlap, calculates stale cutoff and waits for active work on shutdown", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  let claims: number = 0;
  let release: () => void = (): void => {};
  const active: Promise<void> = new Promise<void>((resolve: () => void): void => { release = resolve; });
  const cutoffs: number[] = [];
  const repository: DeploymentQueueRepository = {
    ...emptyRepositories().deployment,
    failStaleProvisioning: async (before: Date): Promise<void> => { cutoffs.push(before.getTime()); },
    claimNextPending: async (): Promise<Deployment> => { claims++; return CLAIMED; },
  };
  const worker: DeploymentWorker = new DeploymentWorker(repository, { exec: async (): Promise<void> => active }, new ConfigService({ AZURE_DEPLOYMENT_TIMEOUT_MS: "1000" }));
  worker.onApplicationBootstrap();
  await flush();
  assert.equal(cutoffs[0], 939_000);
  context.mock.timers.tick(3000);
  await flush();
  assert.equal(claims, 1);
  let stopped: boolean = false;
  const shutdown: Promise<void> = worker.onApplicationShutdown().then((): void => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  release();
  await shutdown;
  context.mock.timers.tick(3000);
  await flush();
  assert.equal(claims, 1);
});

test("shutdown finishes an in-flight claim instead of abandoning its deployment", async (): Promise<void> => {
  let resolveClaim: (deployment: Deployment) => void = (): void => {};
  const claiming: Promise<Deployment> = new Promise<Deployment>((resolve: (deployment: Deployment) => void): void => { resolveClaim = resolve; });
  let processed: number = 0;
  const repository: DeploymentQueueRepository = { ...emptyRepositories().deployment,
    failStaleProvisioning: async (): Promise<void> => {}, claimNextPending: async (): Promise<Deployment> => claiming,
  };
  const worker: DeploymentWorker = new DeploymentWorker(repository, { exec: async (): Promise<void> => { processed++; } }, new ConfigService());
  worker.onApplicationBootstrap();
  await flush();
  const shutdown: Promise<void> = worker.onApplicationShutdown();
  resolveClaim(CLAIMED);
  await shutdown;
  assert.equal(processed, 1);
});

test("deployment worker recovers on a later tick after a repository failure", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  context.mock.method(Logger.prototype, "error", (): void => {});
  let attempts: number = 0;
  let claims: number = 0;
  const repository: DeploymentQueueRepository = { ...emptyRepositories().deployment,
    failStaleProvisioning: async (): Promise<void> => { if (++attempts === 1) throw new Error("DB unavailable"); },
    claimNextPending: async (): Promise<null> => { claims++; return null; },
  };
  const worker: DeploymentWorker = new DeploymentWorker(repository, { exec: async (): Promise<never> => { throw new Error("No work expected"); } }, new ConfigService());
  worker.onApplicationBootstrap();
  await flush();
  assert.equal(claims, 0);
  context.mock.timers.tick(1000);
  await flush();
  assert.equal(claims, 1);
  await worker.onApplicationShutdown();
});

test("build worker bounds its batches and stops polling on shutdown", async (context: TestContext): Promise<void> => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let processed: number = 0;
  let remaining: number = 12;
  const repository: BuildQueueRepository = {
    insert: async (): Promise<void> => {}, update: async (): Promise<void> => {}, updateRun: async (): Promise<void> => {},
    findById: async (): Promise<null> => null, save: async (): Promise<void> => {},
    failStalePreparations: async (): Promise<void> => {},
    claimNextPending: async (): Promise<Build | null> => remaining-- > 0 ? new Build(BUILD) : null,
  };
  const worker: BuildWorker = new BuildWorker(repository, { exec: async (): Promise<void> => { processed++; } });
  worker.onApplicationBootstrap();
  await flush();
  assert.equal(processed, 10);
  context.mock.timers.tick(1000);
  await flush();
  assert.equal(processed, 12);
  await worker.onApplicationShutdown();
  const after: number = remaining;
  context.mock.timers.tick(1000);
  await flush();
  assert.equal(remaining, after);
});
