import { AdminSubscriptionsCase } from "@kumo/application";
import { Permission, type User } from "@kumo/domain";
import { BadRequestException, Body, Controller, Get, Header, Headers, Param, Patch, Query, Req, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { adminBillingError } from "../common/AdminBilling.errors.js";
import { AdminCancellationDto, AdminSubscriptionPageDto, AdminSubscriptionQueryDto, AdminSubscriptionResponseDto } from "../dto/AdminBilling.dto.js";

@ApiTags("subscriptions")
@ApiCookieAuth("session")
@ApiForbiddenResponse({ description: "SubscriptionManage or Super permission required on an active, unsuspended account" })
@ApiNotFoundResponse({ description: "User or user-owned subscription not found" })
@ApiBadRequestResponse({ description: "Invalid query, payload, subscription ID, or Idempotency-Key" })
@ApiConflictResponse({ description: "Stripe subscription state or idempotency conflict" })
@ApiServiceUnavailableResponse({ description: "Stripe subscription management unavailable" })
@Controller("user/:userId/subscriptions")
export class UserSubscriptionsController {
  public constructor(private readonly subscriptions: AdminSubscriptionsCase) {}

  @RequirePermissions(Permission.SubscriptionManage)
  @Get() @Header("Cache-Control", "private, no-store") @ApiOkResponse({ type: AdminSubscriptionPageDto })
  @ApiOperation({ summary: "List a user's Stripe subscriptions in all statuses with cursor pagination" })
  public async list(@Param("userId") userId: string, @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) query: AdminSubscriptionQueryDto): Promise<AdminSubscriptionPageDto> {
    try { return new AdminSubscriptionPageDto(await this.subscriptions.list(userId, query.limit, query.starting_after)); } catch (error: unknown) { return adminBillingError(error); }
  }

  @RequirePermissions(Permission.SubscriptionManage)
  @Patch(":subscriptionId") @Header("Cache-Control", "private, no-store") @ApiOkResponse({ type: AdminSubscriptionResponseDto })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Schedule or undo cancellation at the end of the subscription period", description: "Only accepts cancel_at_period_end. Does not immediately cancel, reactivate an ended subscription, change prices, or remove metered items." })
  public async setCancellation(@Req() request: Request, @Param("userId") userId: string, @Param("subscriptionId") subscriptionId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) body: AdminCancellationDto, @Headers("idempotency-key") key?: string): Promise<AdminSubscriptionResponseDto> {
    if (!/^sub_[A-Za-z0-9]{1,251}$/.test(subscriptionId)) throw new BadRequestException("Invalid subscription ID");
    const actor: User = request.user as User;
    try { return new AdminSubscriptionResponseDto(await this.subscriptions.setCancellation({ actorId: actor.id, userId, subscriptionId, cancelAtPeriodEnd: body.cancel_at_period_end, key })); } catch (error: unknown) { return adminBillingError(error); }
  }
}
