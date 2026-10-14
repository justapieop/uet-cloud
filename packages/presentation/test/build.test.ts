import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Module, ValidationPipe, ClassSerializerInterceptor, type ExecutionContext, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder, type OpenAPIObject } from "@nestjs/swagger";
import { BuildAccessDenied, GetBuildCase, GetBuildSourceCase, TriggerBuildCase, type TriggerBuildInput, type TriggerBuildResult } from "@kumo/application";
import { Build, User, type BuildDetails } from "@kumo/domain";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { DeploymentController } from "../dist/controllers/Deployment.controller.js";
import { LoggedInGuard } from "../dist/common/Auth.guard.js";
import { BuildSourceController } from "../dist/controllers/BuildSource.controller.js";

test("build endpoint validates snake_case input, returns 202, and documents its response", async (context: TestContext): Promise<void> => {
  let allowed: boolean = true;
  let deniedRepository: boolean = false;
  let calls: number = 0;
  const useCase: { exec: (input: TriggerBuildInput) => Promise<TriggerBuildResult> } = {
    exec: async (input: TriggerBuildInput): Promise<TriggerBuildResult> => {
      calls++;
      assert.equal(input.userId, "123");
      assert.equal(input.imageName, "my-app");
      assert.equal(input.dockerFilePath, "docker/Dockerfile");
      if (deniedRepository) throw new BuildAccessDenied("Repository access denied");
      return { buildId: "00000000-0000-4000-8000-000000000001", runUrl: "https://dev.azure.com/run/123", runId: "123", status: "QUEUED", image: "registry.azurecr.io/kumo/123/my-app:tag", commitSha: "a".repeat(40) };
    },
  };
  context.mock.method(LoggedInGuard.prototype, "canActivate", (execution: ExecutionContext): boolean => {
    const request: Request = execution.switchToHttp().getRequest<Request>();
    request.user = new User({ id: "123", displayName: "Alice", suspended: false });
    return allowed;
  });
  class TestModule {}
  Module({
    controllers: [DeploymentController],
    providers: [
      { provide: TriggerBuildCase, useValue: useCase },
      { provide: GetBuildCase, useValue: { exec: async (): Promise<never> => { throw new Error("Not used in this test"); } } },
    ],
  })(TestModule);
  const app: INestApplication = await NestFactory.create(TestModule, { logger: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/deployment/build`;
  const body: { repo: string; image_name: string; dockerfile_path: string; ref: string } = {
    repo: "https://github.com/owner/private-app.git", image_name: "my-app", dockerfile_path: "docker/Dockerfile", ref: "main",
  };
  const success: Response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(success.status, 202);
  assert.deepEqual(await success.json(), {
    build_id: "00000000-0000-4000-8000-000000000001", run_url: "https://dev.azure.com/run/123", run_id: "123", status: "QUEUED", image: "registry.azurecr.io/kumo/123/my-app:tag", commit_sha: "a".repeat(40),
  });
  const invalid: Response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, image_name: "INVALID IMAGE" }) });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 1);
  deniedRepository = true;
  const denied: Response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(denied.status, 403);
  allowed = false;
  const unauthenticated: Response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(unauthenticated.status, 403);
  const document: OpenAPIObject = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  assert.ok(document.paths["/deployment/build"].post?.responses["202"]);
  assert.ok(document.components?.schemas?.BuildResponseDto);
});

test("pipeline endpoints require their assigned bearer token and never expose credentials", async (context: TestContext): Promise<void> => {
  const token: string = "a".repeat(43);
  const id: string = "00000000-0000-4000-8000-000000000001";
  const details: BuildDetails = {
    id, userId: "123", repo: "https://github.com/owner/repo", commitSha: "a".repeat(40),
    dockerFilePath: "Dockerfile", image: `registry.azurecr.io/kumo/123/app:${id}`, status: "QUEUED",
    sourceTokenHash: createHash("sha256").update(token).digest("hex"), sourceExpiresAt: new Date(Date.now() + 60_000),
    runId: "42", runUrl: "https://dev.azure.com/run/42", createdAt: new Date(), updatedAt: new Date(),
  };
  let downloads: number = 0;
  const sourceCase: GetBuildSourceCase = new GetBuildSourceCase({
    findById: async (requested: string): Promise<Build | null> => requested === id ? new Build(details) : null,
    save: async (): Promise<void> => {},
  }, {
    downloadBuildSource: async () => { downloads++; return { archive: new Uint8Array([1, 2, 3]), commitSha: details.commitSha }; },
  }, { prepare: async (archive: Uint8Array): Promise<Uint8Array> => archive });
  class SourceTestModule {}
  Module({ controllers: [BuildSourceController], providers: [{ provide: GetBuildSourceCase, useValue: sourceCase }] })(SourceTestModule);
  const app: INestApplication = await NestFactory.create(SourceTestModule, { logger: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const base: string = `${await app.getUrl()}/builds/${id}`;
  assert.equal((await fetch(`${base}/source`)).status, 401);
  assert.equal((await fetch(`${base}/source`, { headers: { Authorization: `Bearer ${"b".repeat(43)}` } })).status, 401);
  assert.equal(downloads, 0);
  const manifest: Response = await fetch(`${base}/manifest`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await manifest.json(), { image: details.image, dockerfile_path: "Dockerfile", commit_sha: details.commitSha });
  const source: Response = await fetch(`${base}/source`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(source.status, 200);
  assert.match(source.headers.get("Content-Type") ?? "", /application\/gzip/);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(downloads, 1);
});
