import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment } from "@kumo/domain";
import type { AzureDeployPort, DeployAppParams, UpdateAppParams } from "../dist/ports/azure-deploy.js";
import type { DeploymentRepository } from "../dist/ports/deployment.js";
import { CreateDeploymentCase } from "../dist/use-cases/deployment/CreateDeployment.case.js";
import { UpdateDeploymentCase } from "../dist/use-cases/deployment/UpdateDeployment.case.js";

class MockAzureDeployService implements AzureDeployPort {
  public ensuredRgs: string[] = [];
  public deployedApps: DeployAppParams[] = [];
  public updatedApps: UpdateAppParams[] = [];
  public shouldFail: boolean = false;

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
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  public deployments: Map<string, Deployment> = new Map<string, Deployment>();

  public async findById(id: string): Promise<Deployment | null> {
    return this.deployments.get(id) ?? null;
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
