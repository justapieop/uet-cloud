import assert from "node:assert/strict";
import { test } from "node:test";
import { Build, type BuildDetails } from "@kumo/domain";
import { ProcessBuildCase, type PipelineBuildPort } from "../dist/index.js";

const CLAIMED: BuildDetails = {
  id: "build-id", userId: "123", repo: "https://github.com/owner/repo", ref: "main", commitSha: null,
  image: "registry.azurecr.io/app", dockerFilePath: "Dockerfile", status: "PREPARING", error: null,
  sourceTokenHash: "a".repeat(64), sourceExpiresAt: new Date(Date.now() + 60_000),
  runId: null, runUrl: null, createdAt: new Date(), updatedAt: new Date(),
};

test("source resolution persists the full commit tag before scheduling, including legacy queued images", async (): Promise<void> => {
  const sha: string = "abcdef0123".repeat(4);
  const images: readonly string[] = ["registry.azurecr.io/app", "registry.azurecr.io/app:old-tag"];
  for (let index: number = 0; index < images.length; index++) {
    let stored: BuildDetails = { ...CLAIMED, image: images[index]! };
    const pipeline: PipelineBuildPort = {
      getImageAddress: (): never => { throw new Error("Image repository was already selected"); },
      getRun: async (): Promise<never> => { throw new Error("Unexpected status poll"); },
      startBuild: async (id: string): Promise<{ runId: string; runUrl: string; status: "QUEUED" }> => {
        assert.equal(id, CLAIMED.id);
        assert.equal(stored.commitSha, sha);
        assert.equal(stored.image, `registry.azurecr.io/app:${sha}`);
        return { runId: "42", runUrl: "https://example.com/42", status: "QUEUED" };
      },
    };
    await new ProcessBuildCase({
      resolveBuildSource: async (input): Promise<{ commitSha: string }> => {
        assert.equal(input.ref, "main"); return { commitSha: sha.toUpperCase() };
      },
      downloadBuildSource: async (): Promise<never> => { throw new Error("Archive is downloaded by the assigned pipeline"); },
    }, pipeline, { update: async (build: Build): Promise<void> => { stored = build.getDetails(); } }).exec(new Build(stored));
    assert.equal(stored.status, "QUEUED");
    assert.equal(stored.image, `registry.azurecr.io/app:${sha}`);
  }
});

test("malformed commit resolution fails before scheduling or selecting a tag", async (): Promise<void> => {
  let stored: BuildDetails = CLAIMED;
  const pipeline: PipelineBuildPort = {
    getImageAddress: (): string => "",
    startBuild: async (): Promise<never> => { assert.fail("Invalid commits must never launch builds"); },
    getRun: async (): Promise<never> => { throw new Error("Unexpected status poll"); },
  };
  await new ProcessBuildCase({
    resolveBuildSource: async (): Promise<{ commitSha: string }> => ({ commitSha: "main" }),
    downloadBuildSource: async (): Promise<never> => { throw new Error("Unexpected download"); },
  }, pipeline, { update: async (build: Build): Promise<void> => { stored = build.getDetails(); } }).exec(new Build(CLAIMED));
  assert.equal(stored.status, "FAILED");
  assert.equal(stored.commitSha, null);
  assert.equal(stored.image, CLAIMED.image);
  assert.match(stored.error ?? "", /commit SHA/);
});
