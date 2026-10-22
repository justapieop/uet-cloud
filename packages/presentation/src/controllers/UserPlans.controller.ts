import { GetUserPlansCase, PlanSubscriptionForbidden, SubscriptionCheckUnavailable } from "@kumo/application";
import type { Plan, User } from "@kumo/domain";
import { Controller, ForbiddenException, Get, Header, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { UserPlansResponseDto } from "../dto/UserPlans.dto.js";

@ApiTags("plans")
@ApiCookieAuth("session")
@Controller("plans/me")
@UseGuards(LoggedInGuard)
export class UserPlansController {
  public constructor(private readonly getUserPlans: GetUserPlansCase) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Check whether the signed-in user has an active plan", description: "Verifies active Stripe subscriptions and matches active local plans. No linked customer or no matching active subscription returns has_plan=false. Stripe verification failures return 503, not false. Does not reserve quota or grant deployment access." })
  @ApiOkResponse({ type: UserPlansResponseDto })
  @ApiForbiddenResponse({ description: "Authenticated, active, unsuspended user required" })
  @ApiServiceUnavailableResponse({ description: "Stripe subscription verification unavailable" })
  public async get(@Req() request: Request): Promise<UserPlansResponseDto> {
    const user: User | undefined = request.user as User | undefined;
    if (!user?.active || user.suspended) throw new ForbiddenException();
    try {
      const plans: Plan[] = await this.getUserPlans.exec(user.id);
      return new UserPlansResponseDto(plans);
    } catch (error: unknown) {
      if (error instanceof PlanSubscriptionForbidden) throw new ForbiddenException(error.message);
      if (error instanceof SubscriptionCheckUnavailable) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
