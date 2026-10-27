import { ResilienceError } from "@nestjs/resilience";
import { Idempotent } from "@nestjs/idempotency";
import {
  StartDeploymentCase,
  StopDeploymentCase,
  InvalidDeploymentStatusError,
  BuildProviderError,
  BuildNotFound,
  GetBuildCase,
  DeploymentConfigurationReadError,
  AttachVolumeCase,
  DetachVolumeCase,
  ListVolumesCase,
  type DeploymentReadResult,
} from "@kumo/application";
import {
  BadGatewayException,
} from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiCookieAuth,
} from "@nestjs/swagger";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired, SubscriptionCheckUnavailable, DeploymentRequestInProgress, DeploymentRequestKeyReused, CreateDeploymentCase, DeploymentAlreadyExists, DeploymentNotFoundError, GetDeploymentCase } from "@kumo/application";
import { Permission, InvalidDomainParams, type BuildDetails, type Deployment, type DeploymentPortMapping, type DeploymentVolume, type User } from "@kumo/domain";
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header, HttpCode, HttpStatus, NotFoundException, Optional, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors, ValidationPipe, UnprocessableEntityException, ServiceUnavailableException } from "@nestjs/common";
import { ApiServiceUnavailableResponse, ApiHeader, ApiUnprocessableEntityResponse, ApiAcceptedResponse, ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { AdditionalDeploymentPortDto, CreateDeploymentDto, DeploymentResponseDto } from "../dto/Deployment.dto.js";
import { DeploymentVolumeDto, DeploymentVolumeResponseDto } from "../dto/Volume.dto.js";
import { BuildResponseDto } from "../dto/BuildResponse.dto.js";
import { ListDeploymentsQueryDto } from "../dto/ListDeploymentsQuery.dto.js";
import { CacheRead, RouteReadCache, UserReadCacheInterceptor } from "../common/ReadCache.js";

@ApiTags("deployments")
@ApiCookieAuth("session")
@Controller()
@UseGuards(LoggedInGuard)
@ApiForbiddenResponse({ description: "No authenticated session, inactive or suspended user, or required permission missing" })
export class DeploymentsController {
  public constructor(
    private readonly createDeployment: CreateDeploymentCase,
    private readonly getDeployment: GetDeploymentCase,
    private readonly startDeployment: StartDeploymentCase,
    private readonly stopDeployment: StopDeploymentCase,
    private readonly readCache: RouteReadCache,
    private readonly getBuildCase: GetBuildCase,
    @Optional() private readonly attachVolumeCase?: AttachVolumeCase,
    @Optional() private readonly detachVolumeCase?: DetachVolumeCase,
    @Optional() private readonly listVolumesCase?: ListVolumesCase,
  ) {}

  @Post("deployments")
  @RequirePermissions(Permission.DeploymentCreate)
  @Idempotent({ required: true })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Unique key per deployment request; reuse it for retries (1-255 printable ASCII characters)" })
  @ApiUnprocessableEntityResponse({ description: "Idempotency-Key reused with a different request" })
  @Header("Cache-Control", "private, no-store")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue a repository build and deploy its successful image", description: "The resolved Git commit SHA automatically determines the image tag. Do not supply a tag; ref selects the branch, Git tag, or commit to build." })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment input; memory must equal twice vCPU" })
  @ApiConflictResponse({ description: "Deployment name already exists or plan quota exceeded" })
  @ApiForbiddenResponse({ description: "DeploymentCreate permission and an active Stripe subscription linked to an active Kumo plan are required" })
  @ApiServiceUnavailableResponse({ description: "Stripe subscription verification is temporarily unavailable" })
  public async create(@Req() request: Request, @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) input: CreateDeploymentDto): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const deployment: Deployment = await this.createDeployment.exec({
        userId: user.id, name: input.name, idempotencyKey: request.get("Idempotency-Key"),
        spec: {
          region: input.region,
          repo: input.repo, imageName: input.image_name, dockerFilePath: input.dockerfile_path,
          ref: input.ref, targetPort: input.target_port, external: input.external, maxVcpu: input.max_vcpu, maxMemory: input.max_memory,
          additionalPorts: input.additional_ports?.map((port: AdditionalDeploymentPortDto): DeploymentPortMapping => ({
            targetPort: port.target_port, exposedPort: port.exposed_port, external: port.external,
          })),
          volumes: input.volumes?.map((v: DeploymentVolumeDto): DeploymentVolume => ({
            name: v.name, mountPath: v.mount_path, subPath: v.sub_path, sizeGb: v.size_gb, accessMode: v.access_mode,
          })),
          minScaling: input.min_scaling, maxScaling: input.max_scaling, envVars: input.env_vars,
        },
      });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof DeploymentQuotaExceeded) throw new ConflictException({ code: "DEPLOYMENT_QUOTA_EXCEEDED", message: error.message });
      if (error instanceof SubscriptionCheckUnavailable) throw new ServiceUnavailableException(error.message);
      if (error instanceof DeploymentRequestKeyReused) throw new UnprocessableEntityException({ code: "IDEMPOTENCY_KEY_REUSED", message: error.message });
      if (error instanceof DeploymentRequestInProgress) throw new ConflictException({ code: "IDEMPOTENCY_KEY_IN_USE", message: error.message });
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      if (error instanceof DeploymentAlreadyExists) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Post("deployments/:id/start")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DeploymentUpdate)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Start an owned stopped container deployment" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID" })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  @ApiConflictResponse({ description: "Deployment is not in a stopped state" })
  public async start(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const deployment: Deployment = await this.startDeployment.exec({ id, userId: user.id });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof InvalidDeploymentStatusError) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Post("deployments/:id/stop")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DeploymentUpdate)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Stop an owned running container deployment" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID" })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  @ApiConflictResponse({ description: "Deployment is not in a running state" })
  public async stop(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const deployment: Deployment = await this.stopDeployment.exec({ id, userId: user.id });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof InvalidDeploymentStatusError) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Post("deployments/:id/volumes")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DeploymentUpdate)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Attach a persistent volume to an existing deployment" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID or volume specification" })
  @ApiNotFoundResponse({ description: "Deployment not found" })
  @ApiConflictResponse({ description: "Deployment not in RUNNING or STOPPED state, or disk quota exceeded" })
  @ApiForbiddenResponse({ description: "Active Stripe subscription required" })
  public async attachVolume(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) input: DeploymentVolumeDto,
  ): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    if (!this.attachVolumeCase) throw new ServiceUnavailableException("Volume management is not available");
    try {
      const deployment: Deployment = await this.attachVolumeCase.exec({
        userId: user.id,
        deploymentId: id,
        volume: {
          name: input.name,
          mountPath: input.mount_path,
          subPath: input.sub_path,
          sizeGb: input.size_gb,
          accessMode: input.access_mode,
        },
      });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof InvalidDeploymentStatusError) throw new ConflictException(error.message);
      if (error instanceof DeploymentQuotaExceeded) throw new ConflictException({ code: "DEPLOYMENT_QUOTA_EXCEEDED", message: error.message });
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Delete("deployments/:id/volumes/:volumeName")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DeploymentUpdate)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Detach a persistent volume from an existing deployment" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID or volume name" })
  @ApiNotFoundResponse({ description: "Deployment not found" })
  @ApiConflictResponse({ description: "Deployment not in RUNNING or STOPPED state" })
  public async detachVolume(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("volumeName") volumeName: string,
    @Query("delete_data") deleteData?: string,
  ): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    if (!this.detachVolumeCase) throw new ServiceUnavailableException("Volume management is not available");
    try {
      const deployment: Deployment = await this.detachVolumeCase.exec({
        userId: user.id,
        deploymentId: id,
        volumeName,
        deleteData: deleteData === "true",
      });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof InvalidDeploymentStatusError) throw new ConflictException(error.message);
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get("deployments/:id/volumes")
  @RequirePermissions(Permission.DeploymentRead)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List mounted volumes of a deployment" })
  @ApiOkResponse({ type: [DeploymentVolumeResponseDto] })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID" })
  @ApiNotFoundResponse({ description: "Deployment not found" })
  public async listVolumes(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<DeploymentVolumeResponseDto[]> {
    const user: User = this.owner(request);
    if (!this.listVolumesCase) throw new ServiceUnavailableException("Volume management is not available");
    try {
      const volumes: readonly DeploymentVolume[] = await this.listVolumesCase.exec({
        userId: user.id,
        deploymentId: id,
      });
      return volumes.map((v: DeploymentVolume): DeploymentVolumeResponseDto => new DeploymentVolumeResponseDto(v));
    } catch (error: unknown) {
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get("deployments/:id")
  @RequirePermissions(Permission.DeploymentRead)
  @Header("Cache-Control", "private, no-store")
  @CacheRead("deployments", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ summary: "Get an owned deployment's provisioning status" })
  @ApiOkResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID" })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  @ApiBadGatewayResponse({ description: "Azure resource is missing, invalid, or inaccessible" })
  @ApiServiceUnavailableResponse({ description: "Azure configuration is temporarily unavailable" })
  public async get(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const result: DeploymentReadResult = await this.getDeployment.exec(id, user.id);
      return new DeploymentResponseDto(result.deployment, result.configuration);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof DeploymentConfigurationReadError) {
        if (error.reason === "unavailable") throw new ServiceUnavailableException(error.message);
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  @Get("deployments")
  @RequirePermissions(Permission.DeploymentRead)
  @Header("Cache-Control", "private, no-store")
  @CacheRead("deployments", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ summary: "List owned deployments with optional status, name, and region filters" })
  @ApiOkResponse({ type: DeploymentResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: "Invalid or unknown query parameters" })
  @ApiBadGatewayResponse({ description: "An Azure resource is missing, invalid, or inaccessible" })
  @ApiServiceUnavailableResponse({ description: "Azure configuration is temporarily unavailable" })
  public async list(
    @Req() request: Request,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) filters: ListDeploymentsQueryDto,
  ): Promise<DeploymentResponseDto[]> {
    const user: User = this.owner(request);
    try {
      return (await this.getDeployment.list(user.id, filters)).map((result: DeploymentReadResult): DeploymentResponseDto => new DeploymentResponseDto(result.deployment, result.configuration));
    } catch (error: unknown) {
      if (error instanceof DeploymentConfigurationReadError) {
        if (error.reason === "unavailable") throw new ServiceUnavailableException(error.message);
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  @Get("deployment/build/:id")
  @RequirePermissions(Permission.BuildRead)
  @Header("Cache-Control", "private, no-store")
  @CacheRead("builds", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ operationId: "DeploymentController_getBuild", summary: "Get an owned build and refresh its pipeline status" })
  @ApiOkResponse({ type: BuildResponseDto })
  @ApiForbiddenResponse({ description: "No authenticated session, inactive or suspended user, or BuildRead permission missing" })
  @ApiNotFoundResponse({ description: "Build not found for this user" })
  @ApiBadRequestResponse({ description: "Invalid build ID" })
  @ApiBadGatewayResponse({ description: "Azure Pipeline status request failed" })
  public async getBuild(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<BuildResponseDto> {
    const user: User = this.owner(request);
    try {
      const details: BuildDetails = await this.getBuildCase.exec(id, user.id);
      return new BuildResponseDto({ buildId: details.id, runId: details.runId, runUrl: details.runUrl, image: details.image, status: details.status, commitSha: details.commitSha, error: details.error });
    } catch (error: unknown) {
      if (error instanceof ResilienceError) throw error;
      if (error instanceof BuildNotFound) throw new NotFoundException(error.message);
      if (error instanceof BuildProviderError) throw new BadGatewayException(error.message);
      throw new BadGatewayException("Unable to refresh the build status");
    }
  }

  private owner(request: Request): User {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    return user;
  }
}
