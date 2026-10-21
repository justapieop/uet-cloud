import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Module, ClassSerializerInterceptor, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder, type OpenAPIObject } from "@nestjs/swagger";
import { CheckPermissionsCase, CreateDeploymentCase, GetDeploymentCase, StartDeploymentCase, StopDeploymentCase, GetBuildCase, GetBuildSourceCase } from "@kumo/application";
import { Build, type BuildDetails, type Role } from "@kumo/domain";
import { createHash } from "node:crypto";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { BuildSourceController } from "../dist/controllers/BuildSource.controller.js";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { RouteReadCache } from "../dist/common/ReadCache.js";

test("removed build trigger returns 404 and is absent from OpenAPI", async (context: TestContext): Promise<void> => {
  class TestModule {}
  Module({
    controllers: [DeploymentsController],
    // No grants are needed to verify that the removed route is absent.
    providers: [{ provide: CreateDeploymentCase, useValue: {} }, { provide: GetDeploymentCase, useValue: {} }, { provide: StartDeploymentCase, useValue: {} }, { provide: StopDeploymentCase, useValue: {} }, { provide: CheckPermissionsCase, useValue: new CheckPermissionsCase({ findActiveByUserId: async (): Promise<Role[]> => [] }) }, RouteReadCache, { provide: CACHE_MANAGER, useValue: { get: async (): Promise<undefined> => undefined, set: async (): Promise<void> => {} } }, { provide: GetBuildCase, useValue: { exec: async (): Promise<never> => { throw new Error("Build lookup must not run for the removed trigger"); } } }],
  })(TestModule);
  const app: INestApplication = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  await app.listen(0, "127.0.0.1");
  const response: Response = await fetch(`${await app.getUrl()}/deployment/build`, { method: "POST" });
  assert.equal(response.status, 404);
  const document: OpenAPIObject = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  assert.equal(document.paths["/deployment/build"], undefined);
  assert.ok(document.paths["/deployment/build/{id}"].get);
  assert.equal(document.paths["/deployment/build/{id}"].get?.operationId, "DeploymentController_getBuild");
  assert.ok(document.paths["/deployments"].get);
  assert.ok(document.paths["/deployments"].post);
  assert.ok(document.paths["/deployments/{id}"].get);
  assert.ok(document.paths["/deployments/{id}/start"].post);
  assert.ok(document.paths["/deployments/{id}/stop"].post);
});
test("pipeline endpoints require their assigned bearer token and never expose credentials", async (context: TestContext): Promise<void> => {
  const token: string = "a".repeat(43);
  const id: string = "00000000-0000-4000-8000-000000000001";
  const details: BuildDetails = {
    id, userId: "123", repo: "https://github.com/owner/repo", commitSha: "a".repeat(40), ref: null, error: null,
    dockerFilePath: "Dockerfile", image: "registry.azurecr.io/app:v1.2.3", status: "QUEUED",
    sourceTokenHash: createHash("sha256").update(token).digest("hex"), sourceExpiresAt: new Date(Date.now() + 60_000),
    runId: "42", runUrl: "https://dev.azure.com/run/42", createdAt: new Date(), updatedAt: new Date(),
  };
  let downloads: number = 0;
  const sourceCase: GetBuildSourceCase = new GetBuildSourceCase({
    findById: async (requested: string): Promise<Build | null> => requested === id ? new Build(details) : null,
    save: async (): Promise<void> => {},
  }, {
    downloadBuildSource: async () => { downloads++; assert.ok(details.commitSha); return { archive: new Uint8Array([1, 2, 3]), commitSha: details.commitSha }; },
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
  assert.deepEqual(await manifest.json(), { build_id: id, image: details.image, dockerfile_path: "Dockerfile", commit_sha: details.commitSha });
  const source: Response = await fetch(`${base}/source`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(source.status, 200);
  assert.match(source.headers.get("Content-Type") ?? "", /application\/gzip/);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(downloads, 1);
});
