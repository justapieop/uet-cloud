import { ResilienceError } from "@nestjs/resilience";
import { BuildAccessDenied, BuildProviderError, GetBuildSourceCase, InvalidBuildInput } from "@kumo/application";
import { BadGatewayException, BadRequestException, Controller, Get, Header, Headers, Param, ParseUUIDPipe, StreamableFile, UnauthorizedException } from "@nestjs/common";
import { ApiBadGatewayResponse, ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { BuildDetails } from "@kumo/domain";
import { BuildManifestDto } from "../dto/BuildManifest.dto.js";

@ApiTags("build-source")
@ApiBearerAuth("build-source")
@ApiUnauthorizedResponse({ description: "Invalid or expired credential for this build" })
@ApiBadRequestResponse({ description: "Invalid build ID or Dockerfile" })
@ApiBadGatewayResponse({ description: "GitHub download or archive preparation failed" })
@Controller("builds")
export class BuildSourceController {
  public constructor(private readonly source: GetBuildSourceCase) {}

  @Get(":id/manifest")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Get the manifest for a pipeline's assigned build" })
  @ApiOkResponse({ type: BuildManifestDto })
  public async manifest(@Param("id", new ParseUUIDPipe()) id: string, @Headers("authorization") authorization?: string): Promise<BuildManifestDto> {
    try {
      const details: BuildDetails = await this.source.authorize(id, this.token(authorization));
      return new BuildManifestDto(details);
    } catch (error: unknown) { throw this.toHttpError(error); }
  }

  @Get(":id/source")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Download the saved commit's Docker build context" })
  @ApiOkResponse({ content: { "application/gzip": { schema: { type: "string", format: "binary" } } } })
  public async download(@Param("id", new ParseUUIDPipe()) id: string, @Headers("authorization") authorization?: string): Promise<StreamableFile> {
    try {
      const archive: Uint8Array = await this.source.exec(id, this.token(authorization));
      return new StreamableFile(Buffer.from(archive), { type: "application/gzip", disposition: 'attachment; filename="source.tar.gz"' });
    } catch (error: unknown) { throw this.toHttpError(error); }
  }

  private token(authorization?: string): string {
    const match: RegExpMatchArray | null = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i) ?? null;
    if (!match) throw new UnauthorizedException("A build source bearer token is required");
    return match[1];
  }

  private toHttpError(error: unknown): Error {
    if (error instanceof ResilienceError) return error;
    if (error instanceof UnauthorizedException) return error;
    if (error instanceof BuildAccessDenied) return new UnauthorizedException(error.message);
    if (error instanceof InvalidBuildInput) return new BadRequestException(error.message);
    if (error instanceof BuildProviderError) return new BadGatewayException(error.message);
    return new BadGatewayException("Build source preparation failed");
  }
}
