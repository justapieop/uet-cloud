import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { Module, type INestApplication, type Provider, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, type OpenAPIObject, type OperationObject, type PathItemObject } from "@nestjs/swagger";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { CheckPermissionsCase } from "@kumo/application";
import { AuthController } from "../dist/controllers/Auth.controller.js";
import { UserController } from "../dist/controllers/User.controller.js";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentMetricsController } from "../dist/controllers/DeploymentMetrics.controller.js";
import { BuildSourceController } from "../dist/controllers/BuildSource.controller.js";
import { createOpenApiConfig } from "../dist/common/OpenApi.js";

test("OpenAPI covers controller operations, session authentication, and generated client paths", async (context: TestContext): Promise<void> => {
  const controllers: Type<object>[] = [AuthController, UserController, DeploymentsController, DeploymentMetricsController, BuildSourceController];
  // Resolve controllers without starting SQL, sessions, workers, or cloud clients.
  const tokens: Set<Type<object> | string | symbol> = new Set([
    CheckPermissionsCase, CACHE_MANAGER,
    ...controllers.flatMap((controller: Type<object>): Type<object>[] => Reflect.getMetadata("design:paramtypes", controller) ?? []),
  ]);
  class DocumentationModule {}
  Module({ controllers, providers: [...tokens].map((provide: Type<object> | string | symbol): Provider => ({ provide, useValue: {} })) })(DocumentationModule);
  const app: INestApplication = await NestFactory.create(DocumentationModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  const document: OpenAPIObject = SwaggerModule.createDocument(app, createOpenApiConfig());
  const client: string = await readFile(new URL("../../rest/src/schema.ts", import.meta.url), "utf8");
  let count: number = 0;
  Object.entries(document.paths).forEach(([path, methods]: [string, PathItemObject]): void => {
    const verbs: readonly ("get" | "post")[] = ["get", "post"];
    for (let index: number = 0; index < verbs.length; index++) {
      const method: "get" | "post" = verbs[index]!;
      const operation: OperationObject | undefined = methods[method];
      if (!operation) continue;
      count++;
      assert.ok(client.includes(`"${path}":`), `Generated client lacks ${method} ${path}`);
      assert.ok(client.includes(`operations["${operation.operationId}"]`), `Generated client lacks operation ${operation.operationId}`);
      if (path.startsWith("/deployments") || path.startsWith("/deployment/") || path === "/user/me") {
        assert.deepEqual(operation.security, [{ session: [] }], `${method} ${path} must document the session cookie`);
      } else if (path.startsWith("/builds/")) {
        assert.deepEqual(operation.security, [{ "build-source": [] }]);
      } else {
        assert.equal(operation.security, undefined, "Login redirects do not require an existing session");
      }
    }
  });
  assert.equal(count, 13);
  assert.deepEqual(document.components?.securitySchemes?.session, {
    type: "apiKey", in: "cookie", name: "connect.sid",
    description: "Session cookie established by the GitHub login redirect flow at /auth/login.",
  });
  assert.equal(document.components?.securitySchemes?.github, undefined);
  const paths: readonly string[] = ["/deployments/{id}", "/deployments/{id}/start", "/deployments/{id}/stop"];
  for (let index: number = 0; index < paths.length; index++) {
    const path: string = paths[index]!;
    const operation: OperationObject = (document.paths[path]?.get ?? document.paths[path]?.post)!;
    assert.ok(operation.responses["400"], `${path} must document UUID validation failures`);
    assert.ok(operation.responses["200"]);
    assert.equal(operation.responses["201"], undefined);
  }
});
