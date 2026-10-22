import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c, t, type ReadEntry } from "tar";
import type { DockerBuildRequest, RunRequestUnion } from "@azure/arm-containerregistrytasks";
import { ConfigService } from "@nestjs/config";
import { BuildAccessDenied, InvalidBuildInput, TriggerBuildCase, type BuildRepository, type PipelineBuildPort } from "@kumo/application";
import { Build } from "@kumo/domain";
import { AcrProvider, type AcrClient } from "../dist/azure/acr.js";
import { GitHubProvider } from "../dist/github/provider.js";
import { KmsProvider } from "../dist/azure/kms.js";
import { parseGitHubRepository } from "../dist/github/repository.js";
import { prepareBuildContext } from "../dist/azure/build-context.js";
import { runBuildStep } from "../dist/build-errors.js";

async function sourceArchive(): Promise<Buffer> {
  const folder: string = await mkdtemp(join(tmpdir(), "kumo-fixture-"));
  try {
    const source: string = join(folder, "owner-repo-sha");
    await mkdir(source);
    await writeFile(join(source, "Dockerfile"), "FROM scratch\nCOPY hello.txt /hello.txt\n");
    await writeFile(join(source, "hello.txt"), "hello");
    const file: string = join(folder, "source.tar.gz");
    await c({ cwd: folder, file, gzip: true }, ["owner-repo-sha"]);
    return await readFile(file);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("build context accepts a temporary directory reached through a junction or symlink", async (): Promise<void> => {
  const folder: string = await mkdtemp(join(tmpdir(), "kumo-junction-fixture-"));
  try {
    const realTemporary: string = join(folder, "real-temp");
    const linkedTemporary: string = join(folder, "linked-temp");
    await mkdir(realTemporary);
    await symlink(realTemporary, linkedTemporary, process.platform === "win32" ? "junction" : "dir");
    const archiveFile: string = join(folder, "source.tar.gz");
    await writeFile(archiveFile, await sourceArchive());
    const modulePath: string = fileURLToPath(new URL("../dist/azure/build-context.js", import.meta.url));
    const script: string = "import { readFile } from 'node:fs/promises'; import { pathToFileURL } from 'node:url'; const { prepareBuildContext } = await import(pathToFileURL(process.argv[1]).href); await prepareBuildContext(await readFile(process.argv[2]), 'Dockerfile');";
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, modulePath, archiveFile], {
      env: { ...process.env, TEMP: linkedTemporary, TMP: linkedTemporary, TMPDIR: linkedTemporary },
    });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("build context removes GitHub's archive prefix and rejects a missing Dockerfile", async (): Promise<void> => {
  const source: Buffer = await sourceArchive();
  const context: Buffer = await prepareBuildContext(source, "Dockerfile");
  const entries: string[] = [];
  const parser: ReturnType<typeof t> = t({ onReadEntry: (entry: ReadEntry): void => { entries.push(entry.path); entry.resume(); } });
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    parser.on("end", resolve);
    parser.on("error", reject);
    parser.end(context);
  });
  assert.ok(entries.includes("./Dockerfile"));
  assert.ok(entries.includes("./hello.txt"));
  assert.ok(entries.every((path: string): boolean => !path.includes("owner-repo-sha")));
  await assert.rejects(prepareBuildContext(source, "missing/Dockerfile"), InvalidBuildInput);
});

test("quick build uploads source then schedules a push without creating a task", async (context: TestContext): Promise<void> => {
  const config: ConfigService = new ConfigService({
    AZURE_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000000",
    AZURE_CONTAINER_REGISTRY_NAME: "registry",
    AZURE_CONTAINER_REGISTRY_SERVER: "registry.azurecr.io",
    AZURE_RG_NAME: "platform-rg",
  });
  const calls: string[] = [];
  const client: AcrClient = {
    registries: {
      getBuildSourceUploadUrl: async (rg: string, registry: string): Promise<{ uploadUrl: string; relativePath: string }> => {
        assert.equal(rg, "platform-rg");
        assert.equal(registry, "registry");
        calls.push("upload-location");
        return { uploadUrl: "https://storage.example/source?sig=secret", relativePath: "context/source.tar.gz" };
      },
      scheduleRun: async (_rg: string, _registry: string, runRequest: RunRequestUnion): Promise<{ properties: { runId: string; status: string } }> => {
        const request: DockerBuildRequest = runRequest as DockerBuildRequest;
        calls.push("schedule");
        assert.equal(request.type, "DockerBuildRequest");
        assert.equal(request.sourceLocation, "context/source.tar.gz");
        assert.equal(request.isPushEnabled, true);
        assert.deepEqual(request.imageNames, ["registry.azurecr.io/app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
        assert.ok(!("contextAccessToken" in request));
        assert.deepEqual((request as unknown as { credentials: unknown }).credentials, {
          sourceRegistry: { identity: "[caller]", loginMode: "Default" },
        });
        return { properties: { runId: "ca1", status: "Queued" } };
      },
    },
  };
  context.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit): Promise<Response> => {
    calls.push("upload");
    assert.equal(options.method, "PUT");
    assert.equal(new Headers(options.headers).get("x-ms-blob-type"), "BlockBlob");
    assert.ok(options.body instanceof ArrayBuffer);
    return new Response(null, { status: 201 });
  });
  const provider: AcrProvider = new AcrProvider(config, client, (...args: Parameters<typeof fetch>): Promise<Response> => globalThis.fetch(...args));
  const result: unknown = await provider.triggerBuild({
    archive: await sourceArchive(), dockerFilePath: "Dockerfile", imageName: "app", userId: "123", commitSha: "a".repeat(40),
  });
  assert.deepEqual(result, { runId: "ca1", status: "Queued", image: "registry.azurecr.io/app:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  assert.deepEqual(calls, ["upload-location", "upload", "schedule"]);
});

test("queued builds defer the image tag until source resolution and have unique tracking IDs", async (): Promise<void> => {
  const names: string[] = [];
  const records: Map<string, Build> = new Map<string, Build>();
  const repository: BuildRepository & { insert(build: Build): Promise<void> } = {
    findById: async (id: string): Promise<Build | null> => records.get(id) ?? null,
    save: async (build: Build): Promise<void> => { records.set(build.getDetails().id, build); },
    insert: async (build: Build): Promise<void> => { records.set(build.getDetails().id, build); },
  };
  const builder: PipelineBuildPort = {
    getImageAddress: (imageName: string): string => { names.push(imageName); return `registry/${imageName}`; },
    startBuild: async (): Promise<never> => { assert.fail("Pending builds are scheduled by the worker"); },
    getRun: async () => ({ runId: "123", status: "QUEUED" as const, runUrl: "https://dev.azure.com/run/123" }),
  };
  const useCase: TriggerBuildCase = new TriggerBuildCase(builder, repository);
  const input: { userId: string; repo: string; imageName: string } = { userId: "123", repo: "https://github.com/owner/repo", imageName: "app" };
  assert.equal((await useCase.exec(input)).image, "registry/app");
  await useCase.exec(input);
  assert.deepEqual(names, [input.imageName, input.imageName]);
  assert.equal(records.size, 2);
  assert.ok(Array.from(records.values()).every((build: Build): boolean => build.getDetails().commitSha === null && build.getDetails().status === "PENDING"));
  await assert.rejects(useCase.exec({ ...input, dockerFilePath: "../Dockerfile" }), InvalidBuildInput);
});

test("source download denies another user's repository before reading its source", async (context: TestContext): Promise<void> => {
  const kms: KmsProvider = Object.create(KmsProvider.prototype) as KmsProvider;
  const github: GitHubProvider = new GitHubProvider(kms, new ConfigService({ GITHUB_OAUTH2_CLIENT_ID: "app", GITHUB_APP_PRIVATE_KEY_NAME: "key" }), (...args: Parameters<typeof fetch>): Promise<Response> => globalThis.fetch(...args));
  context.mock.method(github, "getRepositoryAccessToken", async (): Promise<string> => "installation-token");
  const calls: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    calls.push(url);
    if (url.endsWith("/user/123")) return Response.json({ login: "alice" });
    if (url.endsWith("/collaborators/alice")) return new Response(null, { status: 404 });
    assert.fail("Source must not be downloaded for an unauthorized user");
  });
  await assert.rejects(github.downloadBuildSource({ userId: "123", repo: "https://github.com/owner/repo" }), BuildAccessDenied);
  assert.equal(calls.length, 2);
});

test("source download pins the commit and keeps the token off the archive redirect", async (context: TestContext): Promise<void> => {
  const kms: KmsProvider = Object.create(KmsProvider.prototype) as KmsProvider;
  const github: GitHubProvider = new GitHubProvider(kms, new ConfigService({ GITHUB_OAUTH2_CLIENT_ID: "app", GITHUB_APP_PRIVATE_KEY_NAME: "key" }), (...args: Parameters<typeof fetch>): Promise<Response> => globalThis.fetch(...args));
  context.mock.method(github, "getRepositoryAccessToken", async (): Promise<string> => "installation-token");
  const sha: string = "a".repeat(40);
  context.mock.method(globalThis, "fetch", async (value: string | URL, options: RequestInit): Promise<Response> => {
    const url: string = String(value);
    if (url.endsWith("/user/123")) return Response.json({ login: "alice" });
    if (url.endsWith("/collaborators/alice")) return new Response(null, { status: 204 });
    if (url.endsWith("/commits/main")) return Response.json({ sha });
    if (url.endsWith(`/tarball/${sha}`)) return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/owner/repo/legacy.tar.gz/sha?token=temporary" } });
    assert.ok(url.startsWith("https://codeload.github.com/"));
    assert.equal(new Headers(options.headers).get("Authorization"), null);
    return new Response("archive");
  });
  const source: { archive: Uint8Array; commitSha: string } = await github.downloadBuildSource({ userId: "123", repo: "https://github.com/owner/repo.git#main" });
  assert.equal(source.commitSha, sha);
  assert.equal(Buffer.from(source.archive).toString(), "archive");
});

test("repository parsing accepts HTTPS and SSH while rejecting arbitrary hosts and credentials", (): void => {
  assert.deepEqual(parseGitHubRepository("git@github.com:owner/repo.git"), { owner: "owner", name: "repo", ref: undefined });
  assert.throws(() => parseGitHubRepository("https://user:token@github.com/owner/repo"), InvalidBuildInput);
  assert.throws(() => parseGitHubRepository("https://example.com/owner/repo"), InvalidBuildInput);
});

test("build failures expose their stage and safe Azure codes without credential-bearing messages", async (): Promise<void> => {
  const error: Error & { code: string; statusCode: number } = Object.assign(
    new Error("Request failed at https://storage.example?sig=secret with Authorization: Bearer secret-token"),
    { name: "RestError", code: "AuthorizationFailed", statusCode: 403 },
  );
  await assert.rejects(runBuildStep("ACR build scheduling", async (): Promise<void> => { throw error; }), {
    message: "ACR build scheduling failed (RestError, AuthorizationFailed, HTTP 403)",
  });
});

test("build failures report network cause codes and preserve input failures", async (): Promise<void> => {
  const cause: Error & { code: string } = Object.assign(new Error("private download URL"), { code: "ENOTFOUND" });
  const error: TypeError = new TypeError("fetch failed", { cause });
  await assert.rejects(runBuildStep("GitHub source download", async (): Promise<void> => { throw error; }), {
    message: "GitHub source download failed (TypeError, ENOTFOUND)",
  });
  const invalid: InvalidBuildInput = new InvalidBuildInput("Missing Dockerfile");
  await assert.rejects(runBuildStep("Source archive preparation", async (): Promise<void> => { throw invalid; }),
    (actual: unknown): boolean => actual === invalid,
  );
});
