import { ResilienceError } from "@nestjs/resilience";
import { BuildNotFound, BuildProviderError, GetBuildCase } from "@kumo/application";
import { BadGatewayException, Controller, ForbiddenException, Get, Header, NotFoundException, Param, ParseUUIDPipe, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBadGatewayResponse, ApiBadRequestResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permission, type BuildDetails, type User } from "@kumo/domain";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { BuildResponseDto } from "../dto/BuildResponse.dto.js";
import { CacheRead, UserReadCacheInterceptor } from "../common/ReadCache.js";

@ApiTags("deployments")
@Controller("deployment")
export class DeploymentController {
  public constructor(
    private readonly getBuildCase: GetBuildCase,
  ) { }

  @Get("build/:id")
  @RequirePermissions(Permission.BuildRead)
  @Header("Cache-Control", "private, no-store")
  @CacheRead("builds", 2000)
  @UseInterceptors(UserReadCacheInterceptor)
  @UseGuards(LoggedInGuard)
  @ApiOperation({ summary: "Get an owned build and refresh its pipeline status" })
  @ApiOkResponse({ type: BuildResponseDto })
  @ApiForbiddenResponse({ description: "No authenticated session, inactive or suspended user, or BuildRead permission missing" })
  @ApiNotFoundResponse({ description: "Build not found for this user" })
  @ApiBadRequestResponse({ description: "Invalid build ID" })
  @ApiBadGatewayResponse({ description: "Azure Pipeline status request failed" })
  public async getBuild(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<BuildResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
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
}
