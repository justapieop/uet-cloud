import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException, ConflictException, BadGatewayException } from "@nestjs/common";
import { Deployment, type DeploymentDetails, type User } from "@kumo/domain";
import {
  DeploymentNotFoundError,
  InvalidDeploymentStatusError,
  BuildProviderError,
  type StartDeploymentCase,
  type StopDeploymentCase,
} from "@kumo/application";
import type { Request } from "express";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentResponseDto } from "../dist/dto/Deployment.dto.js";
import type { RouteReadCache } from "../dist/common/ReadCache.js";

function createMockUser(): User {
  return {
    id: "user-123",
    login: "testuser",
    avatarUrl: "https://avatar.url",
    suspended: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as User;
}

function createMockRequest(user: User = createMockUser()): Request {
  return {
    user,
    get: (): string | undefined => undefined,
  } as unknown as Request;
}

function createDeployment(status: "RUNNING" | "STOPPED"): Deployment {
  const details: DeploymentDetails = {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-123",
    name: "test-app",
    status,
  };
  return new Deployment(details);
}

interface ControllerFixture {
  controller: DeploymentsController;
  invalidatedUsers: string[];
}

function createFixture(overrides: {
  startDeploymentMock?: (input: { id: string; userId: string }) => Promise<Deployment>;
  stopDeploymentMock?: (input: { id: string; userId: string }) => Promise<Deployment>;
} = {}): ControllerFixture {
  const invalidatedUsers: string[] = [];

  const startCase: StartDeploymentCase = {
    exec: overrides.startDeploymentMock ?? (async (): Promise<Deployment> => createDeployment("RUNNING")),
  } as unknown as StartDeploymentCase;

  const stopCase: StopDeploymentCase = {
    exec: overrides.stopDeploymentMock ?? (async (): Promise<Deployment> => createDeployment("STOPPED")),
  } as unknown as StopDeploymentCase;

  const readCache: RouteReadCache = {
    invalidateDeployments: async (userId: string): Promise<void> => {
      invalidatedUsers.push(userId);
    },
  } as unknown as RouteReadCache;

  const createCase: any = {};
  const getCase: any = {};

  const controller: DeploymentsController = new DeploymentsController(
    createCase,
    getCase,
    startCase,
    stopCase,
    readCache,
  );

  return { controller, invalidatedUsers };
}

test("DeploymentsController.start returns DeploymentResponseDto and invalidates cache", async (): Promise<void> => {
  const { controller, invalidatedUsers }: ControllerFixture = createFixture();
  const request: Request = createMockRequest();
  const response: DeploymentResponseDto = await controller.start(request, "00000000-0000-4000-8000-000000000001");

  assert.equal(response.status, "RUNNING");
  assert.equal(response.name, "test-app");
  assert.deepEqual(invalidatedUsers, ["user-123"]);
});

test("DeploymentsController.start throws NotFoundException when deployment not found", async (): Promise<void> => {
  const { controller }: ControllerFixture = createFixture({
    startDeploymentMock: async (): Promise<never> => {
      throw new DeploymentNotFoundError("Not found");
    },
  });
  const request: Request = createMockRequest();
  await assert.rejects(
    controller.start(request, "00000000-0000-4000-8000-000000000001"),
    NotFoundException,
  );
});

test("DeploymentsController.start throws ConflictException when deployment not stopped", async (): Promise<void> => {
  const { controller }: ControllerFixture = createFixture({
    startDeploymentMock: async (): Promise<never> => {
      throw new InvalidDeploymentStatusError("Cannot start deployment in status RUNNING; must be STOPPED");
    },
  });
  const request: Request = createMockRequest();
  await assert.rejects(
    controller.start(request, "00000000-0000-4000-8000-000000000001"),
    ConflictException,
  );
});

test("DeploymentsController.start throws BadGatewayException when Azure fails", async (): Promise<void> => {
  const { controller }: ControllerFixture = createFixture({
    startDeploymentMock: async (): Promise<never> => {
      throw new BuildProviderError("Container App start failed");
    },
  });
  const request: Request = createMockRequest();
  await assert.rejects(
    controller.start(request, "00000000-0000-4000-8000-000000000001"),
    BadGatewayException,
  );
});

test("DeploymentsController.stop returns DeploymentResponseDto and invalidates cache", async (): Promise<void> => {
  const { controller, invalidatedUsers }: ControllerFixture = createFixture();
  const request: Request = createMockRequest();
  const response: DeploymentResponseDto = await controller.stop(request, "00000000-0000-4000-8000-000000000001");

  assert.equal(response.status, "STOPPED");
  assert.equal(response.name, "test-app");
  assert.deepEqual(invalidatedUsers, ["user-123"]);
});

test("DeploymentsController.stop throws ConflictException when deployment not running", async (): Promise<void> => {
  const { controller }: ControllerFixture = createFixture({
    stopDeploymentMock: async (): Promise<never> => {
      throw new InvalidDeploymentStatusError("Cannot stop deployment in status STOPPED; must be RUNNING");
    },
  });
  const request: Request = createMockRequest();
  await assert.rejects(
    controller.stop(request, "00000000-0000-4000-8000-000000000001"),
    ConflictException,
  );
});
