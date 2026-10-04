import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AzureDeployPort,
  DeleteAppParams,
  DeleteResourceGroupParams,
  DeploymentRepository,
  DeployAppParams,
  UpdateAppParams,
} from "@kumo/application";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
  DeleteUserResourceGroupCase,
  UpdateDeploymentCase,
} from "@kumo/application";
import { Deployment } from "@kumo/domain";
import type { Request } from "express";
import { DeploymentMutationController } from "../dist/controllers/DeploymentMutation.controller.js";
import type { CreateDeploymentDto } from "../dist/dto/CreateDeployment.dto.js";
import type { UpdateDeploymentDto } from "../dist/dto/UpdateDeployment.dto.js";
import type { DeploymentResponseDto } from "../dist/dto/DeploymentResponse.dto.js";
import type { DeleteResourceGroupResponseDto } from "../dist/dto/DeleteResourceGroupResponse.dto.js";

class StubAzureDeployService implements AzureDeployPort {
  public getUserResourceGroupName(userId: string): string {
    return `user-rg-${userId}`;
  }

  public async ensureUserResourceGroup(userId: string): Promise<string> {
    return `user-rg-${userId}`;
  }

  public async deployContainerApp(params: DeployAppParams): Promise<{ fqdn: string }> {
    return { fqdn: `https://${params.appName}.example.com` };
  }

  public async updateContainerApp(params: UpdateAppParams): Promise<{ fqdn: string }> {
    return { fqdn: `https://${params.appName}.example.com` };
  }

  public async deleteContainerApp(_params: DeleteAppParams): Promise<void> {}

  public async deleteResourceGroup(
    _params: DeleteResourceGroupParams,
  ): Promise<void> {}
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  private readonly deployments: Map<string, Deployment> =
    new Map<string, Deployment>();

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
      (deployment: Deployment): boolean => deployment.userId === userId,
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

function createController(
  deployService: StubAzureDeployService,
  repository: InMemoryDeploymentRepository,
): DeploymentMutationController {
  const createCase: CreateDeploymentCase = new CreateDeploymentCase(
    deployService,
    repository,
  );
  const updateCase: UpdateDeploymentCase = new UpdateDeploymentCase(
    deployService,
    repository,
  );
  const deleteCase: DeleteDeploymentCase = new DeleteDeploymentCase(
    deployService,
    repository,
  );
  const deleteResourceGroupCase: DeleteUserResourceGroupCase =
    new DeleteUserResourceGroupCase(deployService, repository);

  return new DeploymentMutationController(
    createCase,
    updateCase,
    deleteCase,
    deleteResourceGroupCase,
  );
}

test("DeploymentMutationController create returns accepted response with FQDN", async (): Promise<void> => {
  const deployService: StubAzureDeployService = new StubAzureDeployService();
  const repository: InMemoryDeploymentRepository =
    new InMemoryDeploymentRepository();
  const controller: DeploymentMutationController = createController(
    deployService,
    repository,
  );

  const mockRequest: Request = {
    headers: { "x-user-id": "custom-dev-01" },
  } as unknown as Request;

  const dto: CreateDeploymentDto = {
    name: "test-app",
    spec: {
      image: "nginx:alpine",
      targetPort: 80,
      scaling: { minReplicas: 0, maxReplicas: 2 },
    },
  };

  const response: DeploymentResponseDto = await controller.create(mockRequest, dto);

  assert.equal(response.name, "test-app");
  assert.equal(response.userId, "custom-dev-01");
  assert.equal(response.status, "RUNNING");
  assert.equal(response.spec.image, "nginx:alpine");
  assert.equal(response.spec.targetPort, 80);
  assert.equal(response.fqdn, "https://test-app.example.com");
});

test("DeploymentMutationController update returns updated deployment response", async (): Promise<void> => {
  const deployService: StubAzureDeployService = new StubAzureDeployService();
  const repository: InMemoryDeploymentRepository =
    new InMemoryDeploymentRepository();
  const controller: DeploymentMutationController = createController(
    deployService,
    repository,
  );

  const mockRequest: Request = {
    headers: {},
  } as unknown as Request;

  const dto: UpdateDeploymentDto = {
    spec: {
      image: "nginx:mainline",
      targetPort: 8080,
    },
  };

  const response: DeploymentResponseDto = await controller.update(mockRequest, "test-app-id", dto);

  assert.equal(response.id, "test-app-id");
  assert.equal(response.userId, "dev-user-001");
  assert.equal(response.status, "RUNNING");
  assert.equal(response.spec.image, "nginx:mainline");
  assert.equal(response.spec.targetPort, 8080);
});

test("DeploymentMutationController delete returns a synchronized deployment", async (): Promise<void> => {
  const deployService: StubAzureDeployService = new StubAzureDeployService();
  const repository: InMemoryDeploymentRepository =
    new InMemoryDeploymentRepository();
  const controller: DeploymentMutationController = createController(
    deployService,
    repository,
  );
  await repository.save(
    new Deployment({
      id: "dep-delete",
      userId: "dev01",
      name: "sample-app",
      status: "RUNNING",
      spec: { image: "nginx:latest", targetPort: 80 },
    }),
  );
  const mockRequest: Request = {
    headers: { "x-user-id": "dev01" },
  } as unknown as Request;

  const response: DeploymentResponseDto = await controller.delete(
    mockRequest,
    "dep-delete",
  );

  assert.equal(response.status, "DELETED");
  assert.equal(response.userId, "dev01");
});

test("DeploymentMutationController deletes the current user's resource group", async (): Promise<void> => {
  const deployService: StubAzureDeployService = new StubAzureDeployService();
  const repository: InMemoryDeploymentRepository =
    new InMemoryDeploymentRepository();
  const controller: DeploymentMutationController = createController(
    deployService,
    repository,
  );
  const mockRequest: Request = {
    headers: { "x-user-id": "dev01" },
  } as unknown as Request;

  const response: DeleteResourceGroupResponseDto =
    await controller.deleteResourceGroup(mockRequest);

  assert.equal(response.resourceGroupName, "user-rg-dev01");
  assert.equal(response.status, "DELETED");
});
