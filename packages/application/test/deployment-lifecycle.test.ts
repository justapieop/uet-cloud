import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentDetails } from "@kumo/domain";
import type { DeploymentRepository, ContainerLifecycleManager } from "../dist/ports/index.js";
import { DeploymentNotFoundError } from "../dist/ports/deployment.js";
import { InvalidDeploymentStatusError } from "../dist/use-cases/exceptions/InvalidDeploymentStatus.exception.js";
import { StartDeploymentCase } from "../dist/use-cases/deployment/StartDeployment.case.js";
import { StopDeploymentCase } from "../dist/use-cases/deployment/StopDeployment.case.js";

function createDeployment(status: "RUNNING" | "STOPPED" | "PENDING" | "FAILED"): Deployment {
  const details: DeploymentDetails = {
    id: "dep-1",
    userId: "user-1",
    name: "test-app",
    status,
  };
  return new Deployment(details);
}

test("StartDeploymentCase starts a stopped deployment and updates status to RUNNING", async (): Promise<void> => {
  let stored: Deployment | null = createDeployment("STOPPED");
  const lifecycleCalls: { start: string[]; stop: string[] } = { start: [], stop: [] };

  const repository: DeploymentRepository = {
    findByIdAndUserId: async (id: string, userId: string): Promise<Deployment | null> =>
      stored && stored.id === id && stored.userId === userId ? stored : null,
    update: async (deployment: Deployment): Promise<void> => {
      stored = deployment;
    },
  } as DeploymentRepository;

  const lifecycle: ContainerLifecycleManager = {
    startApp: async (userId: string, appName: string): Promise<void> => {
      lifecycleCalls.start.push(`${userId}/${appName}`);
    },
    stopApp: async (userId: string, appName: string): Promise<void> => {
      lifecycleCalls.stop.push(`${userId}/${appName}`);
    },
  };

  const useCase: StartDeploymentCase = new StartDeploymentCase(repository, lifecycle);
  const result: Deployment = await useCase.exec({ id: "dep-1", userId: "user-1" });

  assert.equal(result.status, "RUNNING");
  assert.equal(stored?.status, "RUNNING");
  assert.deepEqual(lifecycleCalls.start, ["user-1/test-app"]);
  assert.deepEqual(lifecycleCalls.stop, []);
});

test("StartDeploymentCase throws DeploymentNotFoundError when deployment does not exist", async (): Promise<void> => {
  const repository: DeploymentRepository = {
    findByIdAndUserId: async (): Promise<Deployment | null> => null,
  } as DeploymentRepository;

  const lifecycle: ContainerLifecycleManager = {
    startApp: async (): Promise<void> => {},
    stopApp: async (): Promise<void> => {},
  };

  const useCase: StartDeploymentCase = new StartDeploymentCase(repository, lifecycle);
  await assert.rejects(
    useCase.exec({ id: "missing", userId: "user-1" }),
    DeploymentNotFoundError,
  );
});

test("StartDeploymentCase throws InvalidDeploymentStatusError when deployment is not STOPPED", async (): Promise<void> => {
  const stored: Deployment = createDeployment("RUNNING");
  const repository: DeploymentRepository = {
    findByIdAndUserId: async (): Promise<Deployment | null> => stored,
  } as DeploymentRepository;

  const lifecycle: ContainerLifecycleManager = {
    startApp: async (): Promise<void> => {},
    stopApp: async (): Promise<void> => {},
  };

  const useCase: StartDeploymentCase = new StartDeploymentCase(repository, lifecycle);
  await assert.rejects(
    useCase.exec({ id: "dep-1", userId: "user-1" }),
    InvalidDeploymentStatusError,
  );
});

test("StopDeploymentCase stops a running deployment and updates status to STOPPED", async (): Promise<void> => {
  let stored: Deployment | null = createDeployment("RUNNING");
  const lifecycleCalls: { start: string[]; stop: string[] } = { start: [], stop: [] };

  const repository: DeploymentRepository = {
    findByIdAndUserId: async (id: string, userId: string): Promise<Deployment | null> =>
      stored && stored.id === id && stored.userId === userId ? stored : null,
    update: async (deployment: Deployment): Promise<void> => {
      stored = deployment;
    },
  } as DeploymentRepository;

  const lifecycle: ContainerLifecycleManager = {
    startApp: async (userId: string, appName: string): Promise<void> => {
      lifecycleCalls.start.push(`${userId}/${appName}`);
    },
    stopApp: async (userId: string, appName: string): Promise<void> => {
      lifecycleCalls.stop.push(`${userId}/${appName}`);
    },
  };

  const useCase: StopDeploymentCase = new StopDeploymentCase(repository, lifecycle);
  const result: Deployment = await useCase.exec({ id: "dep-1", userId: "user-1" });

  assert.equal(result.status, "STOPPED");
  assert.equal(stored?.status, "STOPPED");
  assert.deepEqual(lifecycleCalls.stop, ["user-1/test-app"]);
  assert.deepEqual(lifecycleCalls.start, []);
});

test("StopDeploymentCase throws InvalidDeploymentStatusError when deployment is not RUNNING", async (): Promise<void> => {
  const stored: Deployment = createDeployment("STOPPED");
  const repository: DeploymentRepository = {
    findByIdAndUserId: async (): Promise<Deployment | null> => stored,
  } as DeploymentRepository;

  const lifecycle: ContainerLifecycleManager = {
    startApp: async (): Promise<void> => {},
    stopApp: async (): Promise<void> => {},
  };

  const useCase: StopDeploymentCase = new StopDeploymentCase(repository, lifecycle);
  await assert.rejects(
    useCase.exec({ id: "dep-1", userId: "user-1" }),
    InvalidDeploymentStatusError,
  );
});
