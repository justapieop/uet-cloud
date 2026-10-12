import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment } from "@kumo/domain";
import type {
  AzureDeployPort,
  DeleteAppParams,
  DeleteResourceGroupParams,
  DeployAppParams,
  UpdateAppParams,
} from "../dist/ports/azure-deploy.js";
import type { DeploymentRepository } from "../dist/ports/deployment.js";
import { CreateDeploymentCase } from "../dist/use-cases/deployment/CreateDeployment.case.js";
import { DeleteDeploymentCase } from "../dist/use-cases/deployment/DeleteDeployment.case.js";
import { DeleteUserResourceGroupCase } from "../dist/use-cases/deployment/DeleteUserResourceGroup.case.js";
import type { DeleteUserResourceGroupResult } from "../dist/use-cases/deployment/DeleteUserResourceGroup.case.js";
import { DeploymentNotFoundError } from "../dist/use-cases/deployment/delete-helpers.js";
import { UpdateDeploymentCase } from "../dist/use-cases/deployment/UpdateDeployment.case.js";

class MockAzureDeployService implements AzureDeployPort {
  public ensuredRgs: string[] = [];
  public deployedApps: DeployAppParams[] = [];
  public updatedApps: UpdateAppParams[] = [];
  public deletedApps: DeleteAppParams[] = [];
  public deletedResourceGroups: DeleteResourceGroupParams[] = [];
  public shouldFail: boolean = false;
  public deleteError: unknown = null;

  public getUserResourceGroupName(userId: string): string {
    return `user-rg-${userId}`;
  }

  public async ensureUserResourceGroup(userId: string): Promise<string> {
    const rg: string = `user-rg-${userId}`;
    this.ensuredRgs.push(rg);
    return rg;
  }

  public async deployContainerApp(params: DeployAppParams): Promise<{ fqdn: string }> {
    if (this.shouldFail) {
      throw new Error("Azure ACA deployment failed");
    }
    this.deployedApps.push(params);
    return { fqdn: `https://${params.appName}.internal.azurecontainerapps.io` };
  }

  public async updateContainerApp(params: UpdateAppParams): Promise<{ fqdn: string }> {
    if (this.shouldFail) {
      throw new Error("Azure ACA update failed");
    }
    this.updatedApps.push(params);
    return { fqdn: `https://${params.appName}.internal.azurecontainerapps.io` };
  }

  public async deleteContainerApp(params: DeleteAppParams): Promise<void> {
    this.deletedApps.push(params);
    if (this.deleteError) {
      throw this.deleteError;
    }
  }

  public async deleteResourceGroup(
    params: DeleteResourceGroupParams,
  ): Promise<void> {
    this.deletedResourceGroups.push(params);
    if (this.deleteError) {
      throw this.deleteError;
    }
  }
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  public deployments: Map<string, Deployment> = new Map<string, Deployment>();

  public async findById(id: string): Promise<Deployment | null> {
    return this.deployments.get(id) ?? null;
  }

  public async findByIdAndUserId(
    id: string,
    userId: string,
  ): Promise<Deployment | null> {
    const deployment: Deployment | undefined = this.deployments.get(id);
    return deployment?.userId === userId ? deployment : null;
  }

  public async findByUserId(userId: string): Promise<Deployment[]> {
    return Array.from(this.deployments.values()).filter(
      (dep: Deployment): boolean => dep.userId === userId,
    );
  }

  public async save(deployment: Deployment): Promise<void> {
    this.deployments.set(deployment.id, deployment);
  }

  public async update(deployment: Deployment): Promise<void> {
    this.deployments.set(deployment.id, deployment);
  }

  public async updateMany(deployments: Deployment[]): Promise<void> {
    for (const deployment of deployments) {
      this.deployments.set(deployment.id, deployment);
    }
  }
}

test("CreateDeploymentCase successfully provisions RG and Container App using spec", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  const useCase: CreateDeploymentCase = new CreateDeploymentCase(azureService, repo);

  const result: Deployment = await useCase.exec({
    id: "dep-1",
    userId: "testuser",
    name: "web-service",
    spec: {
      image: "nginx:latest",
      targetPort: 80,
    },
  });

  assert.equal(result.id, "dep-1");
  assert.equal(result.status, "RUNNING");
  assert.equal(result.fqdn, "https://web-service.internal.azurecontainerapps.io");
  assert.equal(result.spec.image, "nginx:latest");
  assert.equal(result.spec.targetPort, 80);
  assert.deepEqual(azureService.ensuredRgs, ["user-rg-testuser"]);
  assert.equal(azureService.deployedApps.length, 1);
  assert.equal(azureService.deployedApps[0]?.appName, "web-service");
  assert.equal(azureService.deployedApps[0]?.spec.image, "nginx:latest");

  const stored: Deployment | null = await repo.findById("dep-1");
  assert.ok(stored);
  assert.equal(stored.status, "RUNNING");
  assert.equal(stored.fqdn, "https://web-service.internal.azurecontainerapps.io");
});

test("CreateDeploymentCase handles failure and transitions status to FAILED", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  azureService.shouldFail = true;
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  const useCase: CreateDeploymentCase = new CreateDeploymentCase(azureService, repo);

  await assert.rejects(
    async (): Promise<void> => {
      await useCase.exec({
        id: "dep-fail",
        userId: "testuser",
        name: "failing-app",
        spec: {
          image: "bad:image",
          targetPort: 3000,
        },
      });
    },
    /Azure ACA deployment failed/,
  );

  const stored: Deployment | null = await repo.findById("dep-fail");
  assert.ok(stored);
  assert.equal(stored.status, "FAILED");
  assert.equal(stored.errorMessage, "Azure ACA deployment failed");
});

test("UpdateDeploymentCase updates revision using spec patch and transitions status to RUNNING", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();

  const initialDeployment: Deployment = new Deployment({
    id: "dep-up",
    userId: "testuser",
    name: "my-app",
    status: "RUNNING",
    spec: {
      image: "node:18",
      targetPort: 3000,
    },
    fqdn: "https://my-app.internal.azurecontainerapps.io",
  });
  await repo.save(initialDeployment);

  const updateUseCase: UpdateDeploymentCase = new UpdateDeploymentCase(azureService, repo);

  const updated: Deployment = await updateUseCase.exec({
    id: "dep-up",
    userId: "testuser",
    name: "my-app",
    spec: {
      image: "node:20",
    },
  });

  assert.equal(updated.spec.image, "node:20");
  assert.equal(updated.spec.targetPort, 3000);
  assert.equal(updated.status, "RUNNING");
  assert.equal(azureService.updatedApps.length, 1);
  assert.equal(azureService.updatedApps[0]?.spec.image, "node:20");
});

function createStoredDeployment(
  id: string,
  userId: string,
  name: string,
): Deployment {
  return new Deployment({
    id,
    userId,
    name,
    status: "RUNNING",
    spec: {
      image: "nginx:latest",
      targetPort: 80,
    },
    fqdn: `https://${name}.internal.azurecontainerapps.io`,
  });
}

test("DeleteDeploymentCase deletes the owned ACA and synchronizes DB", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-delete", "dev01", "sample-app"));
  const useCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    azureService,
    repo,
  );

  const result: Deployment = await useCase.exec({
    id: "dep-delete",
    userId: "dev01",
  });

  assert.equal(result.status, "DELETED");
  assert.equal(result.fqdn, null);
  assert.deepEqual(azureService.deletedApps, [
    {
      userId: "dev01",
      resourceGroupName: "user-rg-dev01",
      appName: "sample-app",
    },
  ]);
  assert.equal((await repo.findById("dep-delete"))?.status, "DELETED");
});

test("DeleteDeploymentCase does not call Azure for a missing deployment", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  const useCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    azureService,
    repo,
  );

  await assert.rejects(
    useCase.exec({ id: "missing", userId: "dev01" }),
    DeploymentNotFoundError,
  );
  assert.equal(azureService.deletedApps.length, 0);
});

test("DeleteDeploymentCase hides another user's deployment and does not call Azure", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-owned", "dev01", "sample-app"));
  const useCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    azureService,
    repo,
  );

  await assert.rejects(
    useCase.exec({ id: "dep-owned", userId: "dev02" }),
    DeploymentNotFoundError,
  );
  assert.equal(azureService.deletedApps.length, 0);
  assert.equal((await repo.findById("dep-owned"))?.status, "RUNNING");
});

test("DeleteDeploymentCase treats Azure NotFound as deleted and synchronizes DB", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  azureService.deleteError = Object.assign(new Error("missing"), {
    statusCode: 404,
  });
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-stale", "dev01", "sample-app"));
  const useCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    azureService,
    repo,
  );

  const result: Deployment = await useCase.exec({
    id: "dep-stale",
    userId: "dev01",
  });

  assert.equal(result.status, "DELETED");
  assert.equal((await repo.findById("dep-stale"))?.status, "DELETED");
});

test("DeleteDeploymentCase preserves a failed record with a sanitized error", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  azureService.deleteError = new Error(
    "Azure failure access_token=super-secret",
  );
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-failed", "dev01", "sample-app"));
  const useCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    azureService,
    repo,
  );

  await assert.rejects(
    useCase.exec({ id: "dep-failed", userId: "dev01" }),
    /Azure failure/,
  );

  const stored: Deployment | null = await repo.findById("dep-failed");
  assert.equal(stored?.status, "FAILED");
  assert.equal(stored?.errorMessage, "Azure failure access_token=[REDACTED]");
});

test("DeleteUserResourceGroupCase deletes the RG and synchronizes only that user's deployments", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-a", "dev01", "sample-app"));
  await repo.save(createStoredDeployment("dep-b", "dev01", "second-app"));
  await repo.save(createStoredDeployment("dep-c", "dev02", "other-app"));
  const useCase: DeleteUserResourceGroupCase =
    new DeleteUserResourceGroupCase(azureService, repo);

  const result: DeleteUserResourceGroupResult = await useCase.exec({
    userId: "dev01",
  });

  assert.deepEqual(result, {
    resourceGroupName: "user-rg-dev01",
    status: "DELETED",
    deploymentsSynchronized: 2,
  });
  assert.deepEqual(azureService.deletedResourceGroups, [
    { userId: "dev01", resourceGroupName: "user-rg-dev01" },
  ]);
  assert.equal((await repo.findById("dep-a"))?.status, "DELETED");
  assert.equal((await repo.findById("dep-b"))?.status, "DELETED");
  assert.equal((await repo.findById("dep-c"))?.status, "RUNNING");
});

test("DeleteUserResourceGroupCase treats Azure NotFound as a successful synchronization", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  azureService.deleteError = Object.assign(new Error("RG missing"), {
    code: "ResourceGroupNotFound",
  });
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-rg-stale", "dev01", "sample-app"));
  const useCase: DeleteUserResourceGroupCase =
    new DeleteUserResourceGroupCase(azureService, repo);

  const result: DeleteUserResourceGroupResult = await useCase.exec({
    userId: "dev01",
  });

  assert.equal(result.status, "DELETED");
  assert.equal((await repo.findById("dep-rg-stale"))?.status, "DELETED");
});

test("DeleteUserResourceGroupCase marks deployments failed when Azure deletion fails", async (): Promise<void> => {
  const azureService: MockAzureDeployService = new MockAzureDeployService();
  azureService.deleteError = new Error("ARM unavailable");
  const repo: InMemoryDeploymentRepository = new InMemoryDeploymentRepository();
  await repo.save(createStoredDeployment("dep-rg-failed", "dev01", "sample-app"));
  const useCase: DeleteUserResourceGroupCase =
    new DeleteUserResourceGroupCase(azureService, repo);

  await assert.rejects(useCase.exec({ userId: "dev01" }), /ARM unavailable/);

  const stored: Deployment | null = await repo.findById("dep-rg-failed");
  assert.equal(stored?.status, "FAILED");
  assert.equal(stored?.errorMessage, "ARM unavailable");
});
