import { BadRequestException, Controller, ForbiddenException, Get, Header, Query, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { GetDeploymentRegionsCase, type DeploymentRegion } from "@kumo/application";
import type { User } from "@kumo/domain";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { DeploymentRegionResponseDto } from "../dto/DeploymentRegion.dto.js";

@ApiTags("regions")
@ApiCookieAuth("session")
@Controller("regions")
@UseGuards(LoggedInGuard)
export class RegionsController {
  public constructor(private readonly regions: GetDeploymentRegionsCase) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List deployment regions for the configured provisioning mode", description: "Returns the ready shared environment region when supported by Container Apps and the subscription region policy. Environment-count quotas do not filter this result because deployments reuse the environment. Does not reserve app capacity or evaluate all policies. Explicit legacy mode instead uses the preserved subscription/provider/policy/quota catalog. No client-supplied subscription is used." })
  @ApiOkResponse({ type: DeploymentRegionResponseDto, isArray: true })
  @ApiForbiddenResponse({ description: "An active, unsuspended authenticated user is required" })
  @ApiBadRequestResponse({ description: "Query parameters, including subscription selectors, are not accepted" })
  @ApiServiceUnavailableResponse({ description: "Azure region lookup is unavailable" })
  public async list(@Req() request: Request, @Query() query: Record<string, unknown>): Promise<DeploymentRegionResponseDto[]> {
    const user: User = request.user as User;
    if (!user.active) throw new ForbiddenException("An active user is required");
    if (Object.keys(query).length > 0) throw new BadRequestException("Region lookup accepts no query parameters");
    let regions: DeploymentRegion[];
    try {
      regions = await this.regions.exec();
    } catch {
      throw new ServiceUnavailableException("Azure region lookup is unavailable");
    }
    return regions.map((region: DeploymentRegion): DeploymentRegionResponseDto => new DeploymentRegionResponseDto(region));
  }
}
