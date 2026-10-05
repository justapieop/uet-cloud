import assert from "node:assert/strict";
import { test } from "node:test";
import type { AzureDeployPort, DeployAppParams, UpdateAppParams } from "@kumo/application";
import { CreateDeploymentCase, UpdateDeploymentCase } from "@kumo/application";
import type { Request } from "express";
import { DeploymentMutationController } from "../dist/controllers/DeploymentMutation.controller.js";
import type { CreateDeploymentDto } from "../dist/dto/CreateDeployment.dto.js";
import type { UpdateDeploymentDto } from "../dist/dto/UpdateDeployment.dto.js";
import type { DeploymentResponseDto } from "../dist/dto/DeploymentResponse.dto.js";

class StubAzureDeployService implements AzureDeployPort {
  public async ensureUserResourceGroup(userId: string): Promise<string> {
    return `user-rg-${userId}`;
  }

  public async deployContainerApp(params: DeployAppParams): Promise<{ fqdn: string }> {
    return { fqdn: `https://${params.appName}.example.com` };
  }

  public async updateContainerApp(params: UpdateAppParams): Promise<{ fqdn: string }> {
    return { fqdn: `https://${params.appName}.example.com` };
  }
}

test("DeploymentMutationController create returns accepted response with FQDN", async (): Promise<void> => {
  const deployService: StubAzureDeployService = new StubAzureDeployService();
  const createCase: CreateDeploymentCase = new CreateDeploymentCase(deployService);
  const updateCase: UpdateDeploymentCase = new UpdateDeploymentCase(deployService);
  const controller: DeploymentMutationController = new DeploymentMutationController(createCase, updateCase);

  const mockRequest = {
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
  const createCase: CreateDeploymentCase = new CreateDeploymentCase(deployService);
  const updateCase: UpdateDeploymentCase = new UpdateDeploymentCase(deployService);
  const controller: DeploymentMutationController = new DeploymentMutationController(createCase, updateCase);

  const mockRequest = {
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
