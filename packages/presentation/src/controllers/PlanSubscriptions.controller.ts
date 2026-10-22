import { InvalidPlanSubscription, PlanSubscriptionConflict, PlanSubscriptionForbidden, PlanSubscriptionUnavailable, SubscribeToPlanCase, SubscriptionPlanNotFound, type PlanSubscriptionResult } from "@kumo/application";
import type { User } from "@kumo/domain";
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Header, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { PlanSubscriptionResponseDto } from "../dto/PlanSubscription.dto.js";

@ApiTags("plans")
@ApiCookieAuth("session")
@Controller("plans")
@UseGuards(LoggedInGuard)
export class PlanSubscriptionsController {
  public constructor(private readonly subscribe: SubscribeToPlanCase) {}

  @Post(":id/subscriptions")
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Create a Stripe-hosted subscription checkout for the signed-in user", description: "Returns checkout_url for a browser redirect to Stripe. Success and cancellation return to the configured frontend dashboard; redirects do not grant deployment access. Retry the same request with the same Idempotency-Key; a new key represents a new Checkout Session. Stripe's idempotency retention applies." })
  @ApiParam({ name: "id", description: "Local Kumo plan ID", schema: { type: "string", minLength: 1, maxLength: 255 } })
  @ApiBody({ required: false, description: "No body is needed. Only an empty object is accepted; pricing is selected by the server.", schema: { type: "object", additionalProperties: false, maxProperties: 0 } })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Unique printable ASCII key per subscription request (1–255 characters); reuse for retries" })
  @ApiCreatedResponse({ type: PlanSubscriptionResponseDto })
  @ApiBadRequestResponse({ description: "Invalid plan/key or nonempty request body; client price selection is forbidden" })
  @ApiForbiddenResponse({ description: "An active, unsuspended user with a linked Stripe customer is required" })
  @ApiNotFoundResponse({ description: "Plan is missing, inactive, or not linked to Stripe" })
  @ApiConflictResponse({ description: "Stripe idempotency key conflict" })
  @ApiServiceUnavailableResponse({ description: "Stripe unavailable or plan has no valid recurring default price" })
  public async create(
    @Req() request: Request, @Param("id") planId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PlanSubscriptionResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user?.active || user.suspended) throw new ForbiddenException();
    if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0)) {
      throw new BadRequestException("Choose only the plan in the URL; the request body must be empty");
    }
    try {
      const result: PlanSubscriptionResult = await this.subscribe.exec({ userId: user.id, planId, idempotencyKey });
      return new PlanSubscriptionResponseDto(result);
    } catch (error: unknown) {
      if (error instanceof InvalidPlanSubscription) throw new BadRequestException(error.message);
      if (error instanceof PlanSubscriptionForbidden) throw new ForbiddenException(error.message);
      if (error instanceof SubscriptionPlanNotFound) throw new NotFoundException(error.message);
      if (error instanceof PlanSubscriptionConflict) throw new ConflictException(error.message);
      if (error instanceof PlanSubscriptionUnavailable) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
