import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, type CreateDeploymentCase, type GetDeploymentCase } from "@kumo/application";
import { User } from "@kumo/domain";
import type { Request } from "express";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import type { RouteReadCache } from "../dist/common/ReadCache.js";
import type { CreateDeploymentDto } from "../dist/dto/Deployment.dto.js";

test("deployment admission failures map to 403, 409 and 503 without invalidating cache", async (): Promise<void> => {
  const cases: { error: Error; status: number }[] = [
    { error: new DeploymentSubscriptionRequired("Subscribe first"), status: 403 },
    { error: new DeploymentQuotaExceeded("Quota exceeded"), status: 409 },
    { error: new SubscriptionCheckUnavailable("Retry later"), status: 503 },
  ];
  for (let index: number = 0; index < cases.length; index += 1) {
    const item: { error: Error; status: number } = cases[index]!;
    const create: CreateDeploymentCase = { exec: async (): Promise<never> => { throw item.error; } } as unknown as CreateDeploymentCase;
    const cache: RouteReadCache = { invalidateDeployments: async (): Promise<never> => { throw new Error("Unexpected invalidation"); } } as unknown as RouteReadCache;
    const controller: DeploymentsController = new DeploymentsController(create, {} as GetDeploymentCase, cache);
    const request: Request = { user: new User({ id: "123", displayName: "Alice", suspended: false }), get: (): string => "request-key" } as unknown as Request;
    const input: CreateDeploymentDto = { name: "my-app", repo: "https://github.com/owner/repo", tag: "v1", target_port: 8080, max_vcpu: 0.5, max_memory: 1, min_scaling: 0, max_scaling: 2 };
    await assert.rejects(controller.create(request, input), (error: unknown): boolean =>
      (error instanceof ForbiddenException || error instanceof ConflictException || error instanceof ServiceUnavailableException) && error.getStatus() === item.status);
  }
});
