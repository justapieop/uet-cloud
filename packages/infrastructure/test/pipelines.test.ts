import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Build, type BuildDetails } from "@kumo/domain";
import { BuildAccessDenied, BuildNotFound, GetBuildCase, GetBuildSourceCase, type BuildRepository, type PipelineBuildPort } from "@kumo/application";
import { AzurePipelinesProvider } from "../dist/azure/pipelines.js";

const SOURCE_TOKEN: string = "a".repeat(43);

function buildDetails(id: string = "00000000-0000-4000-8000-000000000001"): BuildDetails {
  return {
    id, userId: "123", repo: "https://github.com/owner/repo", commitSha: "a".repeat(40),
    dockerFilePath: "Dockerfile", image: "registry.azurecr.io/app:v1.2.3", status: "QUEUED",
    runId: "42", runUrl: "https://dev.azure.com/run/42",
    sourceTokenHash: createHash("sha256").update(SOURCE_TOKEN).digest("hex"),
    sourceExpiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  };
}

test("pipeline scheduling passes only build ID and a secret scoped source token", async (context: TestContext): Promise<void> => {
  const provider: AzurePipelinesProvider = new AzurePipelinesProvider(new ConfigService({
    AZURE_DEVOPS_ORGANIZATION: "kumo", AZURE_DEVOPS_PROJECT: "Build Platform", AZURE_DEVOPS_PIPELINE_ID: "7",
    AZURE_DEVOPS_PAT: "devops-credential", AZURE_CONTAINER_REGISTRY_SERVER: "registry.azurecr.io",
  }));
  assert.equal(provider.getImageAddress("my-app", "v1.2.3"), "registry.azurecr.io/my-app:v1.2.3");
  context.mock.method(globalThis, "fetch", async (url: string, options: RequestInit): Promise<Response> => {
    assert.equal(url, "https://dev.azure.com/kumo/Build%20Platform/_apis/pipelines/7/runs?api-version=7.1");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body as string), {
      templateParameters: { buildId: "build-id" },
      variables: { kumoSourceToken: { value: SOURCE_TOKEN, isSecret: true } },
    });
    return Response.json({ id: 42, state: "unknown" });
  });
  assert.deepEqual(await provider.startBuild("build-id", SOURCE_TOKEN), {
    runId: "42", status: "QUEUED", runUrl: "https://dev.azure.com/kumo/Build%20Platform/_build/results?buildId=42",
  });
});

test("source access rejects other tokens, expired credentials, and completed builds before GitHub requests", async (): Promise<void> => {
  let details: BuildDetails = buildDetails();
  const repository: BuildRepository = {
    findById: async (id: string): Promise<Build | null> => id === details.id ? new Build(details) : null,
    save: async (): Promise<void> => {},
  };
  const sourceCase: GetBuildSourceCase = new GetBuildSourceCase(repository, {
    downloadBuildSource: async () => { assert.fail("Unauthorized source must not be downloaded"); },
  }, { prepare: async (archive: Uint8Array): Promise<Uint8Array> => archive });
  await assert.rejects(sourceCase.exec(details.id, "b".repeat(43)), BuildAccessDenied);
  await assert.rejects(sourceCase.exec("another-build", SOURCE_TOKEN), BuildAccessDenied);
  details = { ...details, sourceExpiresAt: new Date(Date.now() - 1) };
  await assert.rejects(sourceCase.exec(details.id, SOURCE_TOKEN), BuildAccessDenied);
  details = { ...buildDetails(), status: "SUCCEEDED" };
  await assert.rejects(sourceCase.exec(details.id, SOURCE_TOKEN), BuildAccessDenied);
});

test("authorized source delivery uses the persisted commit and Dockerfile", async (): Promise<void> => {
  const details: BuildDetails = buildDetails();
  const sourceCase: GetBuildSourceCase = new GetBuildSourceCase({
    findById: async (): Promise<Build> => new Build(details), save: async (): Promise<void> => {},
  }, {
    downloadBuildSource: async (input) => {
      assert.equal(input.ref, details.commitSha);
      assert.equal(input.repo, details.repo);
      assert.equal(input.userId, details.userId);
      return { archive: new Uint8Array([1, 2]), commitSha: details.commitSha };
    },
  }, {
    prepare: async (archive: Uint8Array, dockerfile: string): Promise<Uint8Array> => {
      assert.equal(dockerfile, "Dockerfile"); return archive;
    },
  });
  assert.deepEqual(await sourceCase.exec(details.id, SOURCE_TOKEN), new Uint8Array([1, 2]));
});

test("status refresh is limited to the owner and persists pipeline completion", async (): Promise<void> => {
  let stored: Build = new Build(buildDetails());
  let polls: number = 0;
  const pipeline: PipelineBuildPort = {
    getImageAddress: (): string => "",
    startBuild: async () => { assert.fail("Unexpected pipeline launch"); },
    getRun: async () => { polls++; return { runId: "42", runUrl: "https://dev.azure.com/run/42", status: "SUCCEEDED" }; },
  };
  const useCase: GetBuildCase = new GetBuildCase({
    findById: async (): Promise<Build> => stored,
    save: async (build: Build): Promise<void> => { stored = build; },
  }, pipeline);
  await assert.rejects(useCase.exec(stored.getDetails().id, "other-user"), BuildNotFound);
  assert.equal(polls, 0);
  assert.equal((await useCase.exec(stored.getDetails().id, "123")).status, "SUCCEEDED");
  await useCase.exec(stored.getDetails().id, "123");
  assert.equal(polls, 1);
});
