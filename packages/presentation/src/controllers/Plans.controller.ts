import type { Plan } from "@kumo/domain";
import { PlanResponseDto } from "../dto/Plan.dto.js";
import { AdminPlansCase, GetPlansCase } from "@kumo/application";
import { Permission } from "@kumo/domain";
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { adminBillingError } from "../common/AdminBilling.errors.js";
import { AdminPlanCreateDto, AdminPlanPageDto, AdminPlanQueryDto, AdminPlanResponseDto, AdminPlanWriteDto } from "../dto/AdminBilling.dto.js";

@ApiTags("plans")
@Controller("plans")
export class PlansController {
  public constructor(private readonly plans: AdminPlansCase, private readonly getPlans: GetPlansCase) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "List active Stripe-linked plans", description: "Public catalog ordered by local price and ID. Does not verify Stripe availability; Checkout includes all active prices of the linked product." })
  @ApiOkResponse({ type: PlanResponseDto, isArray: true })
  public async list(): Promise<PlanResponseDto[]> {
    const plans: Plan[] = await this.getPlans.exec();
    return plans.map((plan: Plan): PlanResponseDto => new PlanResponseDto(plan));
  }

  @ApiCookieAuth("session")
  @ApiForbiddenResponse({ description: "PlanManage or Super permission required on an active, unsuspended account" })
  @ApiNotFoundResponse({ description: "Plan not found" })
  @ApiBadRequestResponse({ description: "Invalid plan data, quota ratio, or pagination" })
  @ApiConflictResponse({ description: "Plan ID or Stripe product mapping already exists" })
  @RequirePermissions(Permission.PlanManage)
  @Get("all") @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List all local plans, including inactive and unmapped plans" }) @ApiOkResponse({ type: AdminPlanPageDto })
  public async listAll(@Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) query: AdminPlanQueryDto): Promise<AdminPlanPageDto> {
    const result: Awaited<ReturnType<AdminPlansCase["list"]>> = await this.plans.list(query.page, query.per_page);
    return new AdminPlanPageDto(result.plans, query.page, query.per_page, result.hasNextPage);
  }

  @ApiCookieAuth("session")
  @ApiForbiddenResponse({ description: "PlanManage or Super permission required on an active, unsuspended account" })
  @ApiNotFoundResponse({ description: "Plan not found" })
  @ApiBadRequestResponse({ description: "Invalid plan data, quota ratio, or pagination" })
  @ApiConflictResponse({ description: "Plan ID or Stripe product mapping already exists" })
  @RequirePermissions(Permission.PlanManage)
  @Get(":id") @Header("Cache-Control", "private, no-store") @ApiOkResponse({ type: AdminPlanResponseDto })
  @ApiOperation({ summary: "Inspect a local plan" })
  public async get(@Param("id") id: string): Promise<AdminPlanResponseDto> {
    try { return new AdminPlanResponseDto(await this.plans.get(id)); } catch (error: unknown) { return adminBillingError(error); }
  }

  @ApiCookieAuth("session")
  @ApiForbiddenResponse({ description: "PlanManage or Super permission required on an active, unsuspended account" })
  @ApiNotFoundResponse({ description: "Plan not found" })
  @ApiBadRequestResponse({ description: "Invalid plan data, quota ratio, or pagination" })
  @ApiConflictResponse({ description: "Plan ID or Stripe product mapping already exists" })
  @RequirePermissions(Permission.PlanManage)
  @Post() @Header("Cache-Control", "private, no-store") @ApiCreatedResponse({ type: AdminPlanResponseDto })
  @ApiOperation({ summary: "Create a local plan; does not create Stripe products or prices" })
  public async create(@Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: AdminPlanCreateDto): Promise<AdminPlanResponseDto> {
    try { return new AdminPlanResponseDto(await this.plans.create(body.details(body.id))); } catch (error: unknown) { return adminBillingError(error); }
  }

  @ApiCookieAuth("session")
  @ApiForbiddenResponse({ description: "PlanManage or Super permission required on an active, unsuspended account" })
  @ApiNotFoundResponse({ description: "Plan not found" })
  @ApiBadRequestResponse({ description: "Invalid plan data, quota ratio, or pagination" })
  @ApiConflictResponse({ description: "Plan ID or Stripe product mapping already exists" })
  @RequirePermissions(Permission.PlanManage)
  @Put(":id") @Header("Cache-Control", "private, no-store") @ApiOkResponse({ type: AdminPlanResponseDto })
  @ApiOperation({ summary: "Replace a local plan's configuration; ID stays unchanged", description: "Requires all configuration fields. Changes affect subsequent eligibility/quota checks. Does not edit Stripe prices or existing workloads." })
  public async replace(@Param("id") id: string, @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: AdminPlanWriteDto): Promise<AdminPlanResponseDto> {
    try { return new AdminPlanResponseDto(await this.plans.replace(body.details(id))); } catch (error: unknown) { return adminBillingError(error); }
  }

  @ApiCookieAuth("session")
  @ApiForbiddenResponse({ description: "PlanManage or Super permission required on an active, unsuspended account" })
  @ApiNotFoundResponse({ description: "Plan not found" })
  @ApiBadRequestResponse({ description: "Invalid plan data, quota ratio, or pagination" })
  @ApiConflictResponse({ description: "Plan ID or Stripe product mapping already exists" })
  @RequirePermissions(Permission.PlanManage)
  @Delete(":id") @HttpCode(204) @Header("Cache-Control", "private, no-store") @ApiNoContentResponse()
  @ApiOperation({ summary: "Deactivate a plan without deleting it or canceling Stripe subscriptions", description: "Sets active=false. This removes eligibility for subsequent deployment admissions through this plan." })
  public async deactivate(@Param("id") id: string): Promise<void> {
    try { await this.plans.deactivate(id); } catch (error: unknown) { adminBillingError(error); }
  }
}
