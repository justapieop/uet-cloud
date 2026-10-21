import { DeploymentMetricsReadError, DeploymentMetricsUnavailableError, DeploymentNotFoundError, GetDeploymentMetricsCase, InvalidDeploymentResourceError, InvalidMetricsRangeError } from "@kumo/application";
import { Permission, type User } from "@kumo/domain";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { BadGatewayException, BadRequestException, ConflictException, Controller, ForbiddenException, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, Req, ServiceUnavailableException, UseGuards, UseInterceptors, ValidationPipe } from "@nestjs/common";
import { ApiBadGatewayResponse, ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { CacheRead, UserReadCacheInterceptor } from "../common/ReadCache.js";
import { DeploymentMetricsQueryDto, DeploymentMetricsResponseDto } from "../dto/DeploymentMetrics.dto.js";

@ApiTags("deployments")
@Controller("deployments")
@UseGuards(LoggedInGuard)
export class DeploymentMetricsController {
  public constructor(private readonly getMetrics: GetDeploymentMetricsCase) {}

  @Get(":id/metrics")
  @RequirePermissions(Permission.DeploymentRead, Permission.DeploymentMetricsRead)
  @Header("Cache-Control", "private, no-store")
  @CacheRead("monitoring", 60_000)
  @UseInterceptors(UserReadCacheInterceptor)
  @ApiOperation({ summary: "Read Azure Monitor usage for an owned running Container App" })
  @ApiOkResponse({ type: DeploymentMetricsResponseDto })
  @ApiBadRequestResponse({ description: "Invalid deployment UUID or range" })
  @ApiForbiddenResponse({ description: "No authenticated session, inactive or suspended user, or DeploymentRead/DeploymentMetricsRead permission missing" })
  @ApiNotFoundResponse({ description: "Deployment not found for this user" })
  @ApiConflictResponse({ description: "Deployment is not running or its stored Container App ID is invalid" })
  @ApiBadGatewayResponse({ description: "Azure Monitor denied access or returned invalid metric data" })
  @ApiServiceUnavailableResponse({ description: "Azure Monitor is throttling or unavailable" })
  public async get(
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) query: DeploymentMetricsQueryDto,
  ): Promise<DeploymentMetricsResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    try {
      return new DeploymentMetricsResponseDto(await this.getMetrics.exec(id, user.id, query.range));
    } catch (error: unknown) {
      if (error instanceof InvalidMetricsRangeError) throw new BadRequestException(error.message);
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof DeploymentMetricsUnavailableError || error instanceof InvalidDeploymentResourceError) throw new ConflictException(error.message);
      if (error instanceof DeploymentMetricsReadError) {
        if (error.reason === "forbidden") throw new BadGatewayException("Azure Monitor access is denied for this deployment");
        throw new ServiceUnavailableException("Azure Monitor metrics are temporarily unavailable");
      }
      throw error;
    }
  }
}
