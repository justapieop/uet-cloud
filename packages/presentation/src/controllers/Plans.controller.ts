import { GetPlansCase } from "@kumo/application";
import type { Plan } from "@kumo/domain";
import { Controller, Get, Header } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PlanResponseDto } from "../dto/Plan.dto.js";

@ApiTags("plans")
@Controller("plans")
export class PlansController {
  public constructor(private readonly getPlans: GetPlansCase) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "List active Stripe-linked plans", description: "Public catalog ordered by local price and ID. Does not verify Stripe availability; Checkout includes all active prices of the linked product." })
  @ApiOkResponse({ type: PlanResponseDto, isArray: true })
  public async list(): Promise<PlanResponseDto[]> {
    const plans: Plan[] = await this.getPlans.exec();
    return plans.map((plan: Plan): PlanResponseDto => new PlanResponseDto(plan));
  }
}
