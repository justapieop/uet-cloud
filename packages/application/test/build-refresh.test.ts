import assert from "node:assert/strict";
import { test } from "node:test";
import { Build, type BuildDetails } from "@kumo/domain";
import { GetBuildCase } from "../dist/use-cases/deployment/GetBuild.case.js";
import { BuildNotFound, type PipelineRun } from "../dist/ports/build.js";

const DETAILS: BuildDetails = { id: "build", userId: "123", repo: "https://github.com/owner/repo", ref: null, error: null,
  dockerFilePath: "Dockerfile", commitSha: "a".repeat(40), image: "registry/app:v1", status: "QUEUED", runId: "42", runUrl: "https://example.com/42",
  sourceTokenHash: "a".repeat(64), sourceExpiresAt: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
};

test("concurrent build reads share one lookup/refresh and unchanged pipeline state performs no write", async (): Promise<void> => {
  let reads: number = 0;
  let polls: number = 0;
  let writes: number = 0;
  const useCase: GetBuildCase = new GetBuildCase({
    findById: async (): Promise<Build> => { reads++; return new Build(DETAILS); },
    updateRun: async (): Promise<void> => { writes++; },
  }, { getImageAddress: (): string => "unused", startBuild: async (): Promise<never> => { throw new Error("Unexpected build submission"); },
    getRun: async (): Promise<PipelineRun> => { polls++; return { runId: "42", runUrl: "https://example.com/42", status: "QUEUED" }; },
  });
  await Promise.all(Array.from({ length: 10 }, (): Promise<BuildDetails> => useCase.exec("build", "123")));
  assert.equal(reads, 1); assert.equal(polls, 1); assert.equal(writes, 0);
  await assert.rejects(useCase.exec("build", "456"), BuildNotFound);
  assert.equal(polls, 1);
  await useCase.exec("build", "123");
  assert.equal(polls, 2, "Completed in-flight work must not become an authorization or status cache");
});

test("a concurrent terminal update wins over a stale pipeline response", async (): Promise<void> => {
  let stored: Build = new Build(DETAILS);
  const useCase: GetBuildCase = new GetBuildCase({
    findById: async (): Promise<Build> => stored,
    updateRun: async (): Promise<void> => { stored = new Build({ ...DETAILS, status: "SUCCEEDED" }); },
  }, { getImageAddress: (): string => "unused", startBuild: async (): Promise<never> => { throw new Error("Unexpected build submission"); },
    getRun: async (): Promise<PipelineRun> => ({ runId: "42", runUrl: "https://example.com/42", status: "RUNNING" }),
  });
  assert.equal((await useCase.exec("build", "123")).status, "SUCCEEDED");
});
