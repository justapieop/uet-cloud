import { Idempotent } from "@nestjs/idempotency";
import { DeploymentRequestInProgress, DeploymentRequestKeyReused, CreateDeploymentCase, DeploymentAlreadyExists, DeploymentNotFoundError, GetDeploymentCase } from "@kumo/application";
import { InvalidDomainParams, type Deployment, type DeploymentPortMapping, type User } from "@kumo/domain";
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors, ValidationPipe, UnprocessableEntityException } from "@nestjs/common";
import { ApiHeader, ApiUnprocessableEntityResponse, ApiAcceptedResponse, ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { AdditionalDeploymentPortDto, CreateDeploymentDto, DeploymentResponseDto } from "../dto/Deployment.dto.js";
import { ListDeploymentsQueryDto } from "../dto/ListDeploymentsQuery.dto.js";
import { CacheRead, RouteReadCache, UserReadCacheInterceptor } from "../common/ReadCache.js";

@ApiTags("deployments")
@Controller("deployments")
@UseGuards(LoggedInGuard)
@ApiForbiddenResponse({ description: "No authenticated session or suspended user" })
export class DeploymentsController {
  public constructor(private readonly createDeployment: CreateDeploymentCase, private readonly getDeployment: GetDeploymentCase, private readonly readCache: RouteReadCache) {}

  @Post()
  @Idempotent({ required: true })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Unique key per deployment request; reuse it for retries (1–255 printable ASCII characters)" })
  @ApiUnprocessableEntityResponse({ description: "Idempotency-Key reused with a different request" })
  @Header("Cache-Control", "private, no-store")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue a repository build and deploy its successful image" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment input; memory must equal twice vCPU" })
  @ApiConflictResponse({ description: "Deployment name already exists for this user" })
  public async create(@Req() request: Request, @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) input: CreateDeploymentDto): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const deployment: Deployment = await this.createDeployment.exec({
        userId: user.id, name: input.name, idempotencyKey: request.get("Idempotency-Key"),
        spec: {
          region: input.region,
          repo: input.repo, tag: input.tag, imageName: input.image_name, dockerFilePath: input.dockerfile_path,
          ref: input.ref, targetPort: input.target_port, maxVcpu: input.max_vcpu, maxMemory: input.max_memory,
          additionalPorts: input.additional_ports?.map((port: AdditionalDeploymentPortDto): DeploymentPortMapping => ({
            targetPort: port.target_port, exposedPort: port.exposed_port, external: port.external,
          })),
          minScaling: input.min_scaling, maxScaling: input.max_scaling, envVars: input.env_vars,
        },
      });
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof DeploymentRequestKeyReused) throw new UnprocessableEntityException({ code: "IDEMPOTENCY_KEY_REUSED", message: error.message });
      if (error instanceof DeploymentRequestInProgress) throw new ConflictException({ code: "IDEMPOTENCY_KEY_IN_USE", message: error.message });
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      if (error instanceof DeploymentAlreadyExists) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @CacheRead("deployments", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ summary: "Get an owned deployment's provisioning status" })
  @ApiOkResponse({ type: DeploymentResponseDto })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  public async get(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      return new DeploymentResponseDto(await this.getDeployment.exec(id, user.id));
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get()
  @Header("Cache-Control", "private, no-store")
  @CacheRead("deployments", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ summary: "List owned deployments with optional status, name, and region filters" })
  @ApiOkResponse({ type: DeploymentResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: "Invalid or unknown query parameters" })
  public async list(
    @Req() request: Request,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) filters: ListDeploymentsQueryDto,
  ): Promise<DeploymentResponseDto[]> {
    const user: User = this.owner(request);
    return (await this.getDeployment.list(user.id, filters)).map((deployment: Deployment): DeploymentResponseDto => new DeploymentResponseDto(deployment));
  }

  private owner(request: Request): User {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    return user;
  }
}
