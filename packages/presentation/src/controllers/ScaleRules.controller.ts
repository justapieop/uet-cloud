import { DeploymentNotFoundError, DeploymentOperationConflictError, DeploymentOperationLeaseLostError, DeploymentQuotaExceeded, DeploymentSubscriptionRequired, ManageScaleRuleCase, ScaleRuleConflictError, ScaleRuleNotFoundError, SubscriptionCheckUnavailable } from "@kumo/application";
import { InvalidDomainParams, Permission, type ScaleRule, type User } from "@kumo/domain";
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, ServiceUnavailableException, UseGuards, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { CreateScaleRuleDto, ScaleRuleResponseDto, UpdateScaleRuleDto, scaleRuleConfiguration } from "../dto/ScaleRule.dto.js";

@ApiTags("deployments")
@ApiCookieAuth("session")
@Controller("deployments")
@UseGuards(LoggedInGuard)
@RequirePermissions(Permission.DeploymentRead)
@ApiForbiddenResponse({ description: "An eligible session and required deployment permissions are required" })
@ApiNotFoundResponse({ description: "Deployment or rule not found for this owner" })
@ApiBadRequestResponse({ description: "Invalid UUID, rule configuration, or unknown body fields" })
export class ScaleRulesController {
  public constructor(private readonly rules: ManageScaleRuleCase) {}

  @Get(":id/scale-rules")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List the owned deployment's scale rules (zero or one)" })
  @ApiOkResponse({ type: [ScaleRuleResponseDto] })
  public list(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<ScaleRuleResponseDto[]> {
    return this.execute(async (): Promise<ScaleRuleResponseDto[]> => (await this.rules.list(id, this.userId(request))).map((rule: ScaleRule): ScaleRuleResponseDto => new ScaleRuleResponseDto(rule)));
  }

  @Get(":id/scale-rule")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Read the owned deployment's scale rule" })
  @ApiOkResponse({ type: ScaleRuleResponseDto })
  public get(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<ScaleRuleResponseDto> {
    return this.execute(async (): Promise<ScaleRuleResponseDto> => new ScaleRuleResponseDto(await this.rules.get(id, this.userId(request))));
  }

  @Post(":id/scale-rule")
  @RequirePermissions(Permission.DeploymentUpdate, Permission.DeploymentMetricsRead)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Create one CPU scale rule within reserved deployment and current plan limits" })
  @ApiCreatedResponse({ type: ScaleRuleResponseDto })
  @ApiConflictResponse({ description: "Rule exists, deployment busy, or reserved/plan quota exceeded" })
  @ApiServiceUnavailableResponse({ description: "Subscription verification unavailable" })
  public create(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateScaleRuleDto): Promise<ScaleRuleResponseDto> {
    return this.execute(async (): Promise<ScaleRuleResponseDto> => new ScaleRuleResponseDto(await this.rules.save(id, this.userId(request), scaleRuleConfiguration(body), true)));
  }

  @Patch(":id/scale-rule")
  @RequirePermissions(Permission.DeploymentUpdate, Permission.DeploymentMetricsRead)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Update a CPU scale rule; enabled=false pauses future evaluations" })
  @ApiOkResponse({ type: ScaleRuleResponseDto })
  @ApiConflictResponse({ description: "Deployment busy or reserved/plan quota exceeded" })
  @ApiServiceUnavailableResponse({ description: "Subscription verification unavailable" })
  public update(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateScaleRuleDto): Promise<ScaleRuleResponseDto> {
    return this.execute(async (): Promise<ScaleRuleResponseDto> => new ScaleRuleResponseDto(await this.rules.save(id, this.userId(request), scaleRuleConfiguration(body), false)));
  }

  @Delete(":id/scale-rule")
  @RequirePermissions(Permission.DeploymentUpdate)
  @HttpCode(204)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Delete the rule, retaining the current applied replica count" })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: "Another deployment operation is in progress" })
  public delete(@Req() request: Request, @Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    return this.execute((): Promise<void> => this.rules.delete(id, this.userId(request)));
  }

  private userId(request: Request): string {
    const user: User | undefined = request.user as User | undefined;
    if (!user || !user.active || user.suspended) throw new ForbiddenException();
    return user.id;
  }

  private async execute<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error: unknown) {
      if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
      if (error instanceof DeploymentNotFoundError || error instanceof ScaleRuleNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      if (error instanceof SubscriptionCheckUnavailable || error instanceof DeploymentOperationLeaseLostError) throw new ServiceUnavailableException("Scale rule could not be saved; retry after refreshing");
      if (error instanceof ScaleRuleConflictError || error instanceof DeploymentQuotaExceeded || error instanceof DeploymentOperationConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
