import { BuildAccessDenied, BuildNotFound, BuildProviderError, GetBuildCase, InvalidBuildInput, TriggerBuildCase, type TriggerBuildResult } from "@kumo/application";
import { BadGatewayException, BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards, ValidationPipe } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadGatewayResponse, ApiBadRequestResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import type { BuildDetails, User } from "@kumo/domain";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { TriggerBuildDto } from "../dto/TriggerBuild.dto.js";
import { BuildResponseDto } from "../dto/BuildResponse.dto.js";

@ApiTags("deployments")
@Controller("deployment")
export class DeploymentController {
  public constructor(
    private readonly triggerBuildCase: TriggerBuildCase,
    private readonly getBuildCase: GetBuildCase,
  ) { }

  @Post("build")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(LoggedInGuard)
  @ApiOperation({ summary: "Authorize a GitHub commit and queue an Azure Pipeline image build" })
  @ApiAcceptedResponse({ description: "Build queued; the image is pushed when the build succeeds", type: BuildResponseDto })
  @ApiBadRequestResponse({ description: "Invalid build input or missing Dockerfile" })
  @ApiForbiddenResponse({ description: "No authenticated session, suspended user, or no repository access" })
  @ApiBadGatewayResponse({ description: "GitHub, Key Vault, or Azure DevOps request failed" })
  public async triggerBuild(
    @Req() request: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: TriggerBuildDto,
  ): Promise<BuildResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    try {
      const result: TriggerBuildResult = await this.triggerBuildCase.exec({
        userId: user.id,
        repo: body.repo,
        imageName: body.imageName,
        dockerFilePath: body.dockerFilePath,
        ref: body.ref,
      });
      return new BuildResponseDto(result);
    } catch (error: unknown) {
      if (error instanceof InvalidBuildInput) throw new BadRequestException(error.message);
      if (error instanceof BuildAccessDenied) throw new ForbiddenException(error.message);
      if (error instanceof BuildProviderError) throw new BadGatewayException(error.message);
      throw new BadGatewayException("Build preparation failed; verify GitHub, Key Vault, and Azure DevOps configuration and permissions");
    }
  }

  @Get("build/:id")
  @UseGuards(LoggedInGuard)
  @ApiOperation({ summary: "Get an owned build and refresh its pipeline status" })
  @ApiOkResponse({ type: BuildResponseDto })
  @ApiForbiddenResponse({ description: "No authenticated session or suspended user" })
  @ApiNotFoundResponse({ description: "Build not found for this user" })
  @ApiBadRequestResponse({ description: "Invalid build ID" })
  @ApiBadGatewayResponse({ description: "Azure Pipeline status request failed" })
  public async getBuild(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<BuildResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user || user.suspended) throw new ForbiddenException();
    try {
      const details: BuildDetails = await this.getBuildCase.exec(id, user.id);
      return new BuildResponseDto({ buildId: details.id, runId: details.runId ?? "", runUrl: details.runUrl ?? "", image: details.image, status: details.status, commitSha: details.commitSha });
    } catch (error: unknown) {
      if (error instanceof BuildNotFound) throw new NotFoundException(error.message);
      if (error instanceof BuildProviderError) throw new BadGatewayException(error.message);
      throw new BadGatewayException("Unable to refresh the build status");
    }
  }
}
