import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { Module, type INestApplication, type Provider, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, type OpenAPIObject, type OperationObject, type PathItemObject, type RequestBodyObject } from "@nestjs/swagger";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { CheckPermissionsCase } from "@kumo/application";
import { AuthController } from "../dist/controllers/Auth.controller.js";
import { UserController } from "../dist/controllers/User.controller.js";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentMetricsController } from "../dist/controllers/DeploymentMetrics.controller.js";
import { BuildSourceController } from "../dist/controllers/BuildSource.controller.js";
import { PlanSubscriptionsController } from "../dist/controllers/PlanSubscriptions.controller.js";
import { PlansController } from "../dist/controllers/Plans.controller.js";
import { UserPlansController } from "../dist/controllers/UserPlans.controller.js";
import { UserSubscriptionsController } from "../dist/controllers/UserSubscriptions.controller.js";
import { RolesController } from "../dist/controllers/Roles.controller.js";
import { UserRolesController } from "../dist/controllers/UserRoles.controller.js";
import { RegionsController } from "../dist/controllers/Regions.controller.js";
import { RedeploymentsController } from "../dist/controllers/Redeployments.controller.js";
import { GitHubWebhookController } from "../dist/controllers/GitHubWebhook.controller.js";
import { createOpenApiConfig } from "../dist/common/OpenApi.js";

test("OpenAPI covers controller operations, session authentication, and generated client paths", async (context: TestContext): Promise<void> => {
  const controllers: Type<object>[] = [AuthController, UserController, DeploymentsController, DeploymentMetricsController, BuildSourceController, PlansController, UserPlansController, PlanSubscriptionsController, UserSubscriptionsController, RolesController, UserRolesController, RegionsController, RedeploymentsController, GitHubWebhookController];
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
    const verbs: readonly ("get" | "post" | "put" | "delete" | "patch")[] = ["get", "post", "put", "delete", "patch"];
    for (let index: number = 0; index < verbs.length; index++) {
      const method: typeof verbs[number] = verbs[index]!;
      const operation: OperationObject | undefined = methods[method];
      if (!operation) continue;
      count++;
      assert.ok(client.includes(`"${path}":`), `Generated client lacks ${method} ${path}`);
      assert.ok(client.includes(`operations["${operation.operationId}"]`), `Generated client lacks operation ${operation.operationId}`);
      if (path === "/regions" || path.startsWith("/auth/github/") || path.startsWith("/user/") || (path === "/plans" && method !== "get") || path.startsWith("/deployments") || path.startsWith("/deployment/") || path.startsWith("/plans/") || path === "/user/me" || path.startsWith("/roles")) {
        assert.deepEqual(operation.security, [{ session: [] }], `${method} ${path} must document the session cookie`);
      } else if (path.startsWith("/builds/")) {
        assert.deepEqual(operation.security, [{ "build-source": [] }]);
      } else {
        assert.equal(operation.security, undefined, "Public operations do not require an existing session");
      }
    }
  });
  assert.equal(count, 34);
  const webhook: OperationObject = document.paths["/github/webhook"]!.post!;
  assert.ok(webhook.responses["200"]);
  assert.ok(webhook.responses["401"]);
  assert.ok(webhook.responses["503"]);
  assert.equal(Object.keys(document.paths).some((path: string): boolean => path.startsWith("/admin/")), false);
  const checkoutBody: RequestBodyObject = document.paths["/plans/{id}/subscriptions"]!.post!.requestBody as RequestBodyObject;
  assert.equal(checkoutBody.required, false);
  assert.deepEqual(checkoutBody.content["application/json"]?.schema, { type: "object", additionalProperties: false, maxProperties: 0 });
  assert.equal(document.components?.schemas?.SubscribeToPlanDto, undefined);
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
