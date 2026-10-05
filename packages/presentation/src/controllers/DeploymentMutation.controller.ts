import type { Deployment } from "@kumo/domain";
import { CreateDeploymentCase, UpdateDeploymentCase } from "@kumo/application";
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { CreateDeploymentDto } from "../dto/CreateDeployment.dto.js";
import { UpdateDeploymentDto } from "../dto/UpdateDeployment.dto.js";
import { DeploymentResponseDto } from "../dto/DeploymentResponse.dto.js";

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
}
