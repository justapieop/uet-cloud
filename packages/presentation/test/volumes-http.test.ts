import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Volume, type User } from "@kumo/domain";
import {
  VolumeAlreadyExists,
  VolumeInUseError,
  VolumeNotFoundError,
  DeploymentQuotaExceeded,
  type CreateVolumeCase,
  type DeleteVolumeCase,
  type ListUserVolumesCase,
  type UserVolumeItem,
} from "@kumo/application";
import type { Request } from "express";
import { VolumesController } from "../dist/controllers/Volumes.controller.js";
import { CreateStandaloneVolumeDto, VolumeItemResponseDto } from "../dist/dto/VolumeManagement.dto.js";

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

test("VolumesController.list returns list of VolumeItemResponseDto", async (): Promise<void> => {
  const vol: Volume = new Volume({
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-123",
    name: "shared-data",
    sizeGb: 5,
    region: "eastasia",
  });
  const mockItem: UserVolumeItem = {
    volume: vol,
    attachedDeployments: [{ id: "dep-1", name: "my-app" }],
  };

  const listCase: ListUserVolumesCase = {
    exec: async (): Promise<readonly UserVolumeItem[]> => [mockItem],
  } as unknown as ListUserVolumesCase;

  const controller: VolumesController = new VolumesController(
    listCase,
    {} as unknown as CreateVolumeCase,
    {} as unknown as DeleteVolumeCase,
  );

  const result: VolumeItemResponseDto[] = await controller.list(createMockRequest());
  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, "shared-data");
  assert.equal(result[0]?.sizeGb, 5);
  assert.deepEqual(result[0]?.attachedDeployments, [{ id: "dep-1", name: "my-app" }]);
});

test("VolumesController.create returns VolumeItemResponseDto", async (): Promise<void> => {
  const vol: Volume = new Volume({
    id: "00000000-0000-4000-8000-000000000002",
    userId: "user-123",
    name: "new-data",
    sizeGb: 10,
    region: "eastasia",
  });

  const createCase: CreateVolumeCase = {
    exec: async (): Promise<Volume> => vol,
  } as unknown as CreateVolumeCase;

  const controller: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    createCase,
    {} as unknown as DeleteVolumeCase,
  );

  const dto: CreateStandaloneVolumeDto = new CreateStandaloneVolumeDto();
  dto.name = "new-data";
  dto.size_gb = 10;
  dto.region = "eastasia";

  const result: VolumeItemResponseDto = await controller.create(createMockRequest(), dto);
  assert.equal(result.name, "new-data");
  assert.equal(result.sizeGb, 10);
  assert.deepEqual(result.attachedDeployments, []);
});

test("VolumesController.create rejects non-eastasia region", async (): Promise<void> => {
  const controller: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    {} as unknown as CreateVolumeCase,
    {} as unknown as DeleteVolumeCase,
  );

  const dto: CreateStandaloneVolumeDto = new CreateStandaloneVolumeDto();
  dto.name = "new-data";
  dto.size_gb = 10;
  dto.region = "southeastasia";

  await assert.rejects(
    async (): Promise<VolumeItemResponseDto> => controller.create(createMockRequest(), dto),
    { name: "BadRequestException" },
  );
});

test("VolumesController.create maps VolumeAlreadyExists and DeploymentQuotaExceeded to 409", async (): Promise<void> => {
  const createCaseDuplicate: CreateVolumeCase = {
    exec: async (): Promise<Volume> => {
      throw new VolumeAlreadyExists("Volume already exists");
    },
  } as unknown as CreateVolumeCase;

  const controllerDuplicate: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    createCaseDuplicate,
    {} as unknown as DeleteVolumeCase,
  );

  const dto: CreateStandaloneVolumeDto = new CreateStandaloneVolumeDto();
  dto.name = "dup";
  dto.size_gb = 5;

  await assert.rejects(
    controllerDuplicate.create(createMockRequest(), dto),
    (err: unknown): boolean => err instanceof ConflictException,
  );

  const createCaseQuota: CreateVolumeCase = {
    exec: async (): Promise<Volume> => {
      throw new DeploymentQuotaExceeded("Disk limit exceeded");
    },
  } as unknown as CreateVolumeCase;

  const controllerQuota: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    createCaseQuota,
    {} as unknown as DeleteVolumeCase,
  );

  await assert.rejects(
    controllerQuota.create(createMockRequest(), dto),
    (err: unknown): boolean => err instanceof ConflictException,
  );
});

test("VolumesController.delete succeeds and maps errors", async (): Promise<void> => {
  let deletedName: string | null = null;
  const deleteCaseSuccess: DeleteVolumeCase = {
    exec: async (input: { volumeName: string }): Promise<void> => {
      deletedName = input.volumeName;
    },
  } as unknown as DeleteVolumeCase;

  const controllerSuccess: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    {} as unknown as CreateVolumeCase,
    deleteCaseSuccess,
  );

  await controllerSuccess.delete(createMockRequest(), "my-vol");
  assert.equal(deletedName as string | null, "my-vol");

  const deleteCaseInUse: DeleteVolumeCase = {
    exec: async (): Promise<void> => {
      throw new VolumeInUseError("Volume is in use", [{ id: "dep-1", name: "app-1" }]);
    },
  } as unknown as DeleteVolumeCase;

  const controllerInUse: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    {} as unknown as CreateVolumeCase,
    deleteCaseInUse,
  );

  await assert.rejects(
    controllerInUse.delete(createMockRequest(), "in-use-vol"),
    (err: unknown): boolean => err instanceof ConflictException,
  );

  const deleteCaseNotFound: DeleteVolumeCase = {
    exec: async (): Promise<void> => {
      throw new VolumeNotFoundError("Volume not found");
    },
  } as unknown as DeleteVolumeCase;

  const controllerNotFound: VolumesController = new VolumesController(
    {} as unknown as ListUserVolumesCase,
    {} as unknown as CreateVolumeCase,
    deleteCaseNotFound,
  );

  await assert.rejects(
    controllerNotFound.delete(createMockRequest(), "missing-vol"),
    (err: unknown): boolean => err instanceof NotFoundException,
  );
});
