import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose, Type } from "class-transformer";
import type { Plan } from "@kumo/domain";
import { PlanResponseDto } from "./Plan.dto.js";

@Exclude()
export class UserPlansResponseDto {
  @Expose({ name: "has_plan" }) @ApiProperty({ name: "has_plan", description: "True when an active Stripe subscription maps to at least one active local plan; does not indicate remaining quota" })
  public readonly hasPlan: boolean;

  @Expose() @Type(() => PlanResponseDto) @ApiProperty({ type: [PlanResponseDto], description: "Active local plans matching the user's active Stripe subscriptions" })
  public readonly plans: PlanResponseDto[];

  public constructor(plans: readonly Plan[]) {
    this.hasPlan = plans.length > 0;
    this.plans = plans.map((plan: Plan): PlanResponseDto => new PlanResponseDto(plan));
  }
}
