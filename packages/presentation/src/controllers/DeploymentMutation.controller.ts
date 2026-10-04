import type { Deployment } from "@kumo/domain";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
  DeleteUserResourceGroupCase,
  DeploymentNotFoundError,
  UnsafeResourceGroupError,
  UpdateDeploymentCase,
  type DeleteUserResourceGroupResult,
} from "@kumo/application";
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { CreateDeploymentDto } from "../dto/CreateDeployment.dto.js";
import { UpdateDeploymentDto } from "../dto/UpdateDeployment.dto.js";
import { DeploymentResponseDto } from "../dto/DeploymentResponse.dto.js";
import { DeleteResourceGroupResponseDto } from "../dto/DeleteResourceGroupResponse.dto.js";

function extractUserId(request: Request): string {
  const reqObj: Record<string, unknown> = request as unknown as Record<string, unknown>;
  const user: unknown = reqObj.user;
  const userObj: { id?: string } | undefined =
    user && typeof user === "object" ? (user as { id?: string }) : undefined;
  const headerUserId: string | undefined = request.headers["x-user-id"] as
    | string
    | undefined;

  return userObj?.id ?? headerUserId ?? "dev-user-001";
}

@ApiTags("deployments")
@Controller("deployments")
@UseInterceptors(ClassSerializerInterceptor)
export class DeploymentMutationController {
  public constructor(
    private readonly createDeploymentCase: CreateDeploymentCase,
    private readonly updateDeploymentCase: UpdateDeploymentCase,
    private readonly deleteDeploymentCase: DeleteDeploymentCase,
    private readonly deleteUserResourceGroupCase: DeleteUserResourceGroupCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Create and deploy a new container application" })
  @ApiAcceptedResponse({
    description: "Deployment has been initiated",
    type: DeploymentResponseDto,
  })
  public async create(
    @Req() request: Request,
    @Body() dto: CreateDeploymentDto,
  ): Promise<DeploymentResponseDto> {
    const userId: string = extractUserId(request);

    const deployment: Deployment = await this.createDeploymentCase.exec({
      userId,
      name: dto.name,
      spec: dto.spec,
    });

    return new DeploymentResponseDto(deployment);
  }

  @Patch(":id")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Update an existing container application configuration" })
  @ApiParam({ name: "id", description: "Deployment ID" })
  @ApiAcceptedResponse({
    description: "Deployment update has been initiated",
    type: DeploymentResponseDto,
  })
  public async update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() dto: UpdateDeploymentDto,
  ): Promise<DeploymentResponseDto> {
    const userId: string = extractUserId(request);

    const deployment: Deployment = await this.updateDeploymentCase.exec({
      id,
      userId,
      spec: dto.spec ?? {},
    });

    return new DeploymentResponseDto(deployment);
  }

  @Delete("resource-group/me")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete the current user's resource group" })
  @ApiOkResponse({
    description: "Resource group and deployment records were synchronized",
    type: DeleteResourceGroupResponseDto,
  })
  public async deleteResourceGroup(
    @Req() request: Request,
  ): Promise<DeleteResourceGroupResponseDto> {
    const userId: string = extractUserId(request);

    try {
      const result: DeleteUserResourceGroupResult =
        await this.deleteUserResourceGroupCase.exec({ userId });
      return new DeleteResourceGroupResponseDto(result);
    } catch (error: unknown) {
      if (error instanceof UnsafeResourceGroupError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete an existing container application" })
  @ApiParam({ name: "id", description: "Deployment ID" })
  @ApiOkResponse({
    description: "Container App was deleted and its deployment was synchronized",
    type: DeploymentResponseDto,
  })
  public async delete(
    @Req() request: Request,
    @Param("id") id: string,
  ): Promise<DeploymentResponseDto> {
    const userId: string = extractUserId(request);

    try {
      const deployment: Deployment = await this.deleteDeploymentCase.exec({
        id,
        userId,
      });
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof UnsafeResourceGroupError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
