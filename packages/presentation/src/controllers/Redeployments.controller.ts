import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, ServiceUnavailableException, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import { Idempotent } from "@nestjs/idempotency";
import { RedeployDeploymentCase, DeploymentNotFoundError, DeploymentQuotaExceeded, DeploymentRequestKeyReused, DeploymentSubscriptionRequired, InvalidDeploymentStatusError, SubscriptionCheckUnavailable } from "@kumo/application";
import { InvalidDomainParams, Permission, type User } from "@kumo/domain";
import type { Request } from "express";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { RouteReadCache } from "../common/ReadCache.js";
import { DeploymentResponseDto } from "../dto/Deployment.dto.js";

@ApiTags("deployments")
@ApiCookieAuth("session")
@Controller("deployments")
@UseGuards(LoggedInGuard)
export class RedeploymentsController {
  public constructor(private readonly redeploy: RedeployDeploymentCase, private readonly cache: RouteReadCache) {}

  @Post(":id/redeploy")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permission.DeploymentUpdate)
  @Idempotent({ required: true })
  @ApiOperation({ summary: "Rebuild and update an owned existing deployment", description: "Resolves the saved Git reference again, builds and pushes its commit-tagged image, then updates only the existing app's main-container image. No repository-push webhook is configured by this endpoint." })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ required: false, schema: { type: "object", additionalProperties: false, maxProperties: 0 } })
  @ApiAcceptedResponse({ type: DeploymentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid UUID/key or nonempty request body" })
  @ApiForbiddenResponse({ description: "Active unsuspended user, DeploymentUpdate, and active eligible subscription required" })
  @ApiNotFoundResponse({ description: "Deployment not owned by the current user" })
  @ApiConflictResponse({ description: "Deployment is busy, stopped, unprovisioned, or over current plan quota" })
  @ApiServiceUnavailableResponse({ description: "Subscription verification unavailable" })
  @ApiUnprocessableEntityResponse({ description: "Idempotency-Key reused with a different request" })
  public async create(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown): Promise<DeploymentResponseDto> {
    if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length > 0)) throw new BadRequestException("Redeploy accepts no request fields");
    const user: User = request.user as User;
    try {
      const result: Awaited<ReturnType<RedeployDeploymentCase["exec"]>> = await this.redeploy.exec(id, user.id, request.get("Idempotency-Key") ?? "");
      await this.cache.invalidateDeployments(user.id);
      return new DeploymentResponseDto(result);
    } catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof InvalidDeploymentStatusError || error instanceof DeploymentQuotaExceeded) throw new ConflictException(error.message);
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof SubscriptionCheckUnavailable) throw new ServiceUnavailableException(error.message);
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      if (error instanceof DeploymentRequestKeyReused) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
