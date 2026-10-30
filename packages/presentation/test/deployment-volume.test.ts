import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { Deployment, type DeploymentDetails, type DeploymentVolume, type User } from "@kumo/domain";
import {
  DeploymentNotFoundError,
  InvalidDeploymentStatusError,
  DeploymentQuotaExceeded,
  type AttachVolumeCase,
  type AttachVolumeInput,
  type DetachVolumeCase,
  type DetachVolumeInput,
  type ListVolumesCase,
  type ListVolumesInput,
  type CreateDeploymentCase,
  type GetDeploymentCase,
  type StartDeploymentCase,
  type StopDeploymentCase,
  type GetBuildCase,
  type DeploymentConfiguration,
} from "@kumo/application";
import type { Request } from "express";
import { DeploymentsController } from "../dist/controllers/Deployments.controller.js";
import { DeploymentResponseDto } from "../dist/dto/Deployment.dto.js";
import { DeploymentVolumeDto, DeploymentVolumeResponseDto } from "../dist/dto/Volume.dto.js";
import type { RouteReadCache } from "../dist/common/ReadCache.js";

function createMockUser(): User {
  return {
    id: "user-123",
    login: "testuser",
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

function createTestDeployment(volumes: DeploymentVolume[] = []): Deployment {
  const details: DeploymentDetails = {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-123",
    name: "my-app",
    status: "RUNNING",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes,
    },
  };
  return new Deployment(details);
}

test("DeploymentsController.attachVolume returns DeploymentResponseDto and invalidates cache", async (): Promise<void> => {
  const invalidatedUsers: string[] = [];
  const readCache: RouteReadCache = {
    invalidateDeployments: async (userId: string): Promise<void> => {
      invalidatedUsers.push(userId);
    },
  } as unknown as RouteReadCache;

  const volumeDto: DeploymentVolumeDto = new DeploymentVolumeDto();
  volumeDto.name = "data";
  volumeDto.mount_path = "/var/data";
  volumeDto.size_gb = 32;
  volumeDto.access_mode = "ReadWrite";

  const attachCase: AttachVolumeCase = {
    exec: async (input: AttachVolumeInput): Promise<Deployment> => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.deploymentId, "00000000-0000-4000-8000-000000000001");
      assert.equal(input.volume.name, "data");
      return createTestDeployment([input.volume]);
    },
  } as unknown as AttachVolumeCase;

  const controller: DeploymentsController = new DeploymentsController(
    {} as CreateDeploymentCase,
    {} as GetDeploymentCase,
    {} as StartDeploymentCase,
    {} as StopDeploymentCase,
    readCache,
    {} as GetBuildCase,
    attachCase,
    {} as DetachVolumeCase,
    {} as ListVolumesCase,
  );

  const response: DeploymentResponseDto = await controller.attachVolume(
    createMockRequest(),
    "00000000-0000-4000-8000-000000000001",
    volumeDto,
  );

  assert.equal(response.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(response.volumes.length, 1);
  assert.equal(response.volumes[0]?.name, "data");
  assert.equal(response.volumes[0]?.mountPath, "/var/data");
  assert.equal(response.volumes[0]?.sizeGb, 32);
  assert.deepEqual(invalidatedUsers, ["user-123"]);
});

test("DeploymentsController.attachVolume maps InvalidDeploymentStatusError and DeploymentQuotaExceeded to 409", async (): Promise<void> => {
  const volumeDto: DeploymentVolumeDto = new DeploymentVolumeDto();
  volumeDto.name = "data";
  volumeDto.mount_path = "/var/data";
  volumeDto.size_gb = 32;

  const attachStatusErrCase: AttachVolumeCase = {
    exec: async (): Promise<Deployment> => {
      throw new InvalidDeploymentStatusError("Deployment must be in RUNNING or STOPPED state to attach volume");
    },
  } as unknown as AttachVolumeCase;

  const controllerStatusErr: DeploymentsController = new DeploymentsController(
    {} as CreateDeploymentCase,
    {} as GetDeploymentCase,
    {} as StartDeploymentCase,
    {} as StopDeploymentCase,
    {} as RouteReadCache,
    {} as GetBuildCase,
    attachStatusErrCase,
  );

  await assert.rejects(
    controllerStatusErr.attachVolume(createMockRequest(), "00000000-0000-4000-8000-000000000001", volumeDto),
    ConflictException,
  );

  const attachQuotaErrCase: AttachVolumeCase = {
    exec: async (): Promise<Deployment> => {
      throw new DeploymentQuotaExceeded("Total volume size exceeds the plan's disk limit");
    },
  } as unknown as AttachVolumeCase;

  const controllerQuotaErr: DeploymentsController = new DeploymentsController(
    {} as CreateDeploymentCase,
    {} as GetDeploymentCase,
    {} as StartDeploymentCase,
    {} as StopDeploymentCase,
    {} as RouteReadCache,
    {} as GetBuildCase,
    attachQuotaErrCase,
  );

  await assert.rejects(
    controllerQuotaErr.attachVolume(createMockRequest(), "00000000-0000-4000-8000-000000000001", volumeDto),
    ConflictException,
  );
});

test("DeploymentsController.detachVolume removes volume, returns DeploymentResponseDto and invalidates cache", async (): Promise<void> => {
  const invalidatedUsers: string[] = [];
  const readCache: RouteReadCache = {
    invalidateDeployments: async (userId: string): Promise<void> => {
      invalidatedUsers.push(userId);
    },
  } as unknown as RouteReadCache;

  const detachCase: DetachVolumeCase = {
    exec: async (input: DetachVolumeInput): Promise<Deployment> => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.deploymentId, "00000000-0000-4000-8000-000000000001");
      assert.equal(input.volumeName, "data");
      assert.equal(input.deleteData, true);
      return createTestDeployment([]);
    },
  } as unknown as DetachVolumeCase;

  const controller: DeploymentsController = new DeploymentsController(
    {} as CreateDeploymentCase,
    {} as GetDeploymentCase,
    {} as StartDeploymentCase,
    {} as StopDeploymentCase,
    readCache,
    {} as GetBuildCase,
    {} as AttachVolumeCase,
    detachCase,
    {} as ListVolumesCase,
  );

  const response: DeploymentResponseDto = await controller.detachVolume(
    createMockRequest(),
    "00000000-0000-4000-8000-000000000001",
    "data",
    "true",
  );

  assert.equal(response.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(response.volumes.length, 0);
  assert.deepEqual(invalidatedUsers, ["user-123"]);
});

test("DeploymentsController.listVolumes returns list of DeploymentVolumeResponseDto", async (): Promise<void> => {
  const volumes: DeploymentVolume[] = [
    { name: "data", mountPath: "/var/data", sizeGb: 32, accessMode: "ReadWrite" },
  ];

  const listCase: ListVolumesCase = {
    exec: async (input: ListVolumesInput): Promise<readonly DeploymentVolume[]> => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.deploymentId, "00000000-0000-4000-8000-000000000001");
      return volumes;
    },
  } as unknown as ListVolumesCase;

  const controller: DeploymentsController = new DeploymentsController(
    {} as CreateDeploymentCase,
    {} as GetDeploymentCase,
    {} as StartDeploymentCase,
    {} as StopDeploymentCase,
    {} as RouteReadCache,
    {} as GetBuildCase,
    {} as AttachVolumeCase,
    {} as DetachVolumeCase,
    listCase,
  );

  const response: DeploymentVolumeResponseDto[] = await controller.listVolumes(
    createMockRequest(),
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(response.length, 1);
  assert.equal(response[0]?.name, "data");
  assert.equal(response[0]?.mountPath, "/var/data");
  assert.equal(response[0]?.sizeGb, 32);
  assert.equal(response[0]?.accessMode, "ReadWrite");
});

test("DeploymentResponseDto preserves volume sizeGb and accessMode from spec when configuration volumes are present", (): void => {
  const deployment: Deployment = createTestDeployment([
    { name: "data", mountPath: "/var/data", sizeGb: 32, accessMode: "ReadWrite" },
  ]);
  const configuration: DeploymentConfiguration = {
    region: "eastasia",
    maxVcpu: 0.25,
    maxMemory: 0.5,
    minScaling: 0,
    maxScaling: 1,
    targetPort: 80,
    external: true,
    additionalPorts: [],
    volumes: [
      { name: "data", mountPath: "/var/data", sizeGb: 1, accessMode: "ReadWrite" },
    ],
    image: "image:tag",
    fqdn: "app.example.com",
  };

  const response: DeploymentResponseDto = new DeploymentResponseDto(deployment, configuration);
  assert.equal(response.volumes.length, 1);
  assert.equal(response.volumes[0]?.name, "data");
  assert.equal(response.volumes[0]?.mountPath, "/var/data");
  assert.equal(response.volumes[0]?.sizeGb, 32);
  assert.equal(response.volumes[0]?.accessMode, "ReadWrite");
});
