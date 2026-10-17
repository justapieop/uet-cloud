import {
  CreateDeploymentCase,
  DeploymentAlreadyExists,
  DeploymentMetricsReaderError,
  DeploymentMetricsUnavailableError,
  DeploymentNotFoundError,
  GetDeploymentCase,
  GetDeploymentMetricsCase,
  type DeploymentMetricsSnapshot,
} from "@kumo/application";
import { InvalidDomainParams, type Deployment, type DeploymentPortMapping, type User } from "@kumo/domain";
import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException, UseGuards, ValidationPipe } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadGatewayResponse, ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { AdditionalDeploymentPortDto, CreateDeploymentDto, DeploymentResponseDto } from "../dto/Deployment.dto.js";
import { DeploymentMetricsQueryDto, DeploymentMetricsResponseDto } from "../dto/DeploymentMetrics.dto.js";

@ApiTags("deployments")
@Controller("deployments")
@UseGuards(LoggedInGuard)
@ApiForbiddenResponse({ description: "No authenticated session or suspended user" })
export class DeploymentsController {
  public constructor(
    private readonly createDeployment: CreateDeploymentCase,
    private readonly getDeployment: GetDeploymentCase,
    private readonly getDeploymentMetrics: GetDeploymentMetricsCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue a repository build and deploy its successful image" })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment input; memory must equal twice vCPU" })
  @ApiConflictResponse({ description: "Deployment name already exists for this user" })
  public async create(@Req() request: Request, @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) input: CreateDeploymentDto): Promise<DeploymentResponseDto> {
    const user: User = this.owner(request);
    try {
      const deployment: Deployment = await this.createDeployment.exec({
        userId: user.id, name: input.name,
        spec: {
          repo: input.repo, tag: input.tag, imageName: input.image_name, dockerFilePath: input.dockerfile_path,
          ref: input.ref, targetPort: input.target_port, maxVcpu: input.max_vcpu, maxMemory: input.max_memory,
          additionalPorts: input.additional_ports?.map((port: AdditionalDeploymentPortDto): DeploymentPortMapping => ({
            targetPort: port.target_port, exposedPort: port.exposed_port, external: port.external,
          })),
          minScaling: input.min_scaling, maxScaling: input.max_scaling, envVars: input.env_vars,
        },
      });
      return new DeploymentResponseDto(deployment);
    } catch (error: unknown) {
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      if (error instanceof DeploymentAlreadyExists) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get(":id")
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
  @ApiOkResponse({ type: DeploymentResponseDto, isArray: true })
  public async list(@Req() request: Request): Promise<DeploymentResponseDto[]> {
    const user: User = this.owner(request);
    return (await this.getDeployment.list(user.id)).map((deployment: Deployment): DeploymentResponseDto => new DeploymentResponseDto(deployment));
  }

  @Get(":id/metrics")
  @ApiOperation({ summary: "Get Azure Monitor CPU, working-set memory, and active replicas for an owned deployment" })
  @ApiQuery({ name: "range", required: true, enum: ["1h", "6h", "24h"] })
  @ApiOkResponse({ type: DeploymentMetricsResponseDto })
  @ApiBadRequestResponse({ description: "Deployment ID or range is invalid" })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  @ApiConflictResponse({ description: "Deployment is not running or has no Azure resource ID" })
  @ApiBadGatewayResponse({ description: "Azure Monitor could not provide metrics" })
  @ApiServiceUnavailableResponse({ description: "Azure Monitor is throttling requests; retry later" })
  public async metrics(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) query: DeploymentMetricsQueryDto,
  ): Promise<DeploymentMetricsResponseDto> {
    const user: User = this.owner(request);
    try {
      const snapshot: DeploymentMetricsSnapshot = await this.getDeploymentMetrics.exec(id, user.id, query.range);
      return new DeploymentMetricsResponseDto(id, query.range, snapshot);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof DeploymentMetricsUnavailableError) throw new ConflictException(error.message);
      if (error instanceof DeploymentMetricsReaderError) {
        if (error.kind === "configuration_missing") throw new ServiceUnavailableException("Azure Monitor is not configured for this API");
        if (error.kind === "rate_limited") throw new ServiceUnavailableException("Azure Monitor is temporarily throttling metrics requests");
        throw new BadGatewayException("Azure Monitor could not provide metrics for this deployment");
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
