import {
  CreateVolumeCase,
  DeleteVolumeCase,
  DeploymentQuotaExceeded,
  DeploymentSubscriptionRequired,
  ListUserVolumesCase,
  VolumeAlreadyExists,
  VolumeInUseError,
  VolumeNotFoundError,
  type UserVolumeItem,
} from "@kumo/application";
import { InvalidDomainParams, Permission, type User, type Volume } from "@kumo/domain";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import {
  CreateStandaloneVolumeDto,
  VolumeItemResponseDto,
} from "../dto/VolumeManagement.dto.js";

@ApiTags("volumes")
@ApiCookieAuth("session")
@Controller("volumes")
@UseGuards(LoggedInGuard)
@ApiForbiddenResponse({ description: "No authenticated session, inactive or suspended user, or required permission missing" })
export class VolumesController {
  public constructor(
    private readonly listUserVolumesCase: ListUserVolumesCase,
    private readonly createVolumeCase: CreateVolumeCase,
    private readonly deleteVolumeCase: DeleteVolumeCase,
  ) {}

  @Get()
  @RequirePermissions(Permission.DeploymentRead)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List all persistent volumes owned by the current user" })
  @ApiOkResponse({ type: [VolumeItemResponseDto] })
  public async list(@Req() request: Request): Promise<VolumeItemResponseDto[]> {
    const user: User = this.owner(request);
    const items: readonly UserVolumeItem[] = await this.listUserVolumesCase.exec({ userId: user.id });
    return items.map((item: UserVolumeItem): VolumeItemResponseDto => new VolumeItemResponseDto(item));
  }

  @Post()
  @RequirePermissions(Permission.DeploymentCreate)
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Create a new standalone persistent storage volume" })
  @ApiCreatedResponse({ type: VolumeItemResponseDto })
  @ApiBadRequestResponse({ description: "Invalid volume parameters" })
  @ApiConflictResponse({ description: "Volume name already exists or disk quota exceeded" })
  public async create(
    @Req() request: Request,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) input: CreateStandaloneVolumeDto,
  ): Promise<VolumeItemResponseDto> {
    const user: User = this.owner(request);
    const region: string = input.region?.trim() || "eastus2";

    try {
      const volume: Volume = await this.createVolumeCase.exec({
        userId: user.id,
        name: input.name.trim(),
        sizeGb: input.size_gb,
        region,
      });
      return new VolumeItemResponseDto(volume, []);
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof VolumeAlreadyExists) throw new ConflictException({ code: "VOLUME_ALREADY_EXISTS", message: error.message });
      if (error instanceof DeploymentQuotaExceeded) throw new ConflictException({ code: "DEPLOYMENT_QUOTA_EXCEEDED", message: error.message });
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Delete(":name")
  @RequirePermissions(Permission.DeploymentDelete)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Delete an unattached persistent volume and its underlying Azure File Share" })
  @ApiNoContentResponse({ description: "Volume deleted successfully" })
  @ApiNotFoundResponse({ description: "Volume not found" })
  @ApiConflictResponse({ description: "Volume is currently mounted to one or more deployments" })
  public async delete(
    @Req() request: Request,
    @Param("name") name: string,
  ): Promise<void> {
    const user: User = this.owner(request);

    try {
      await this.deleteVolumeCase.exec({
        userId: user.id,
        volumeName: name,
      });
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof VolumeNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof VolumeInUseError) {
        throw new ConflictException({
          code: "VOLUME_IN_USE",
          message: error.message,
          attachedDeployments: error.attachedDeployments,
        });
      }
      throw error;
    }
  }

  private owner(request: Request): User {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    return user;
  }
}
