import {
  DeploymentConfigurationReadError, DeploymentNotFoundError, DeploymentOperationConflictError,
  DeploymentQuotaExceeded, DeploymentRequestKeyReused, DeploymentResourceUpdateError,
  DeploymentResourceUpdateNotFound, DeploymentResourceUpdatesDisabled, DeploymentResourceVersionMismatch,
  DeploymentResourceVersionRequired, DeploymentSubscriptionRequired, GetDeploymentResourceUpdateCase,
  SubscriptionCheckUnavailable, UpdateDeploymentResourcesCase,
} from "@kumo/application";
import { InvalidDomainParams, Permission, type DeploymentResourceUpdate, type DeploymentResourceUpdateReceipt, type User } from "@kumo/domain";
import {
  BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Get, Header, HttpCode, HttpException, HttpStatus, NotFoundException, Param, ParseUUIDPipe,
  Patch, Req, Res, ServiceUnavailableException, UnprocessableEntityException, UseGuards, ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { Idempotent } from "@nestjs/idempotency";
import {
  ApiAcceptedResponse, ApiBadGatewayResponse, ApiBadRequestResponse, ApiConflictResponse,
  ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiResponse, ApiServiceUnavailableResponse, ApiTags, ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { RouteReadCache } from "../common/ReadCache.js";
import { DeploymentResourceOwnerGuard } from "../common/DeploymentResourceOwner.guard.js";
import { DeploymentResourceUpdateReceiptDto, DeploymentResourceUpdateResponseDto, UpdateDeploymentResourcesDto } from "../dto/DeploymentResources.dto.js";

@ApiTags("deployments")
@ApiCookieAuth("session")
@Controller("deployments/:id")
@UseGuards(LoggedInGuard)
@ApiForbiddenResponse({ description: "Active unsuspended owner session and required permission are required" })
export class DeploymentResourcesController {
  public constructor(
    private readonly updateResources: UpdateDeploymentResourcesCase,
    private readonly getResourceUpdate: GetDeploymentResourceUpdateCase,
    private readonly readCache: RouteReadCache,
  ) {}

  @Patch()
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permission.DeploymentUpdate)
  @UseGuards(DeploymentResourceOwnerGuard)
  @Idempotent({
    required: true,
    scope: (request: Request): string => {
      const user: User | undefined = request.user as User | undefined;
      if (!request.isAuthenticated?.() || !user?.active || user.suspended) throw new ForbiddenException();
      return JSON.stringify([user.id, "deployment.resources", request.params.id]);
    },
    fingerprint: (payload: unknown, context: ExecutionContext): unknown => {
      const header: string | undefined = context.switchToHttp().getRequest<Request>().get("If-Match");
      const version: string | null = header?.startsWith('"') && header.endsWith('"') ? header.slice(1, -1) : header ?? null;
      return { body: payload, configurationVersion: version };
    },
  })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue an owned deployment's compute and replica configuration update", description: "Requires a verified Single revision baseline and active plan. Admission is disabled by default. Stopped apps are rejected until Azure preservation is verified." })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "1-255 printable ASCII characters; repeat with the same body and If-Match" })
  @ApiHeader({ name: "If-Match", required: true, description: "Opaque Kumo configuration_version from a fresh deployment read" })
  @ApiAcceptedResponse({ type: DeploymentResourceUpdateReceiptDto, headers: { Location: { description: "Owner-scoped operation status URL", schema: { type: "string" } } } })
  @ApiBadRequestResponse({ description: "Invalid UUID/key or full compute configuration; unknown fields are rejected" })
  @ApiNotFoundResponse({ description: "Deployment not found for this owner" })
  @ApiConflictResponse({ description: "Deployment busy, quota exceeded, or lifecycle/revision baseline unsupported" })
  @ApiResponse({ status: 412, description: "If-Match differs from the live stable baseline" })
  @ApiResponse({ status: 428, description: "If-Match is required" })
  @ApiUnprocessableEntityResponse({ description: "Idempotency-Key reused with a different configuration or version" })
  @ApiBadGatewayResponse({ description: "Applied Azure configuration is invalid or missing" })
  @ApiServiceUnavailableResponse({ description: "Feature disabled, or Azure/Stripe unavailable" })
  public async update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: false })) input: UpdateDeploymentResourcesDto,
  ): Promise<DeploymentResourceUpdateReceiptDto> {
    const user: User = this.owner(request);
    try {
      const receipt: DeploymentResourceUpdateReceipt = await this.updateResources.exec(id, user.id,
        request.get("Idempotency-Key") ?? "", request.get("If-Match"),
        { maxVcpu: input.max_vcpu, maxMemory: input.max_memory, minScaling: input.min_scaling, maxScaling: input.max_scaling });
      response.setHeader("Location", `/deployments/${id}/resource-updates/${receipt.operationId}`);
      await this.readCache.invalidateDeployments(user.id);
      return new DeploymentResourceUpdateReceiptDto(receipt);
    } catch (error: unknown) { this.mapError(error); }
  }

  @Get("resource-updates/:operationId")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permission.DeploymentRead)
  @ApiOperation({ summary: "Read an owned deployment's resource update operation" })
  @ApiOkResponse({ type: DeploymentResourceUpdateResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment or operation UUID" })
  @ApiNotFoundResponse({ description: "Deployment or operation not found for this owner" })
  public async get(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
  ): Promise<DeploymentResourceUpdateResponseDto> {
    const user: User = this.owner(request);
    try {
      const operation: DeploymentResourceUpdate = await this.getResourceUpdate.exec(id, operationId, user.id);
      return new DeploymentResourceUpdateResponseDto(operation);
    } catch (error: unknown) { this.mapError(error); }
  }

  private owner(request: Request): User {
    const user: User | undefined = request.user as User | undefined;
    if (!user || !user.active || user.suspended) throw new ForbiddenException();
    return user;
  }

  private mapError(error: unknown): never {
    if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
    if (error instanceof DeploymentNotFoundError || error instanceof DeploymentResourceUpdateNotFound) throw new NotFoundException("Deployment or resource update not found");
    if (error instanceof DeploymentResourceVersionRequired) throw new HttpException({ code: "CONFIGURATION_VERSION_REQUIRED", message: "If-Match is required" }, 428);
    if (error instanceof DeploymentResourceVersionMismatch) throw new HttpException({ code: "CONFIGURATION_VERSION_MISMATCH", message: "Deployment configuration changed; refresh and retry" }, 412);
    if (error instanceof DeploymentRequestKeyReused) throw new UnprocessableEntityException({ code: "IDEMPOTENCY_KEY_REUSED", message: error.message });
    if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
    if (error instanceof SubscriptionCheckUnavailable) throw new ServiceUnavailableException(error.message);
    if (error instanceof DeploymentQuotaExceeded || error instanceof DeploymentOperationConflictError) throw new ConflictException(error.message);
    if (error instanceof DeploymentResourceUpdatesDisabled) throw new ServiceUnavailableException({ code: "RESOURCE_UPDATES_DISABLED", message: "Deployment resource updates are not enabled" });
    if (error instanceof DeploymentConfigurationReadError) {
      if (error.reason === "unavailable") throw new ServiceUnavailableException(error.message);
      throw new BadGatewayException(error.message);
    }
    if (error instanceof DeploymentResourceUpdateError) {
      if (error.code === "RESOURCE_READ_UNAVAILABLE") throw new ServiceUnavailableException({ code: error.code, message: error.message });
      if (error.code === "RESOURCE_IDENTITY_INVALID" || error.code === "RESOURCE_CONFIGURATION_INVALID" || error.code === "RESOURCE_MISSING") throw new BadGatewayException({ code: error.code, message: error.message });
      throw new ConflictException({ code: error.code, message: error.message });
    }
    throw error;
  }
}
