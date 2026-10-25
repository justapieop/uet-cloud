import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import type { PlanSubscriptionResult } from "@kumo/application";

@Exclude()
export class PlanSubscriptionResponseDto {
  @Expose({ name: "checkout_session_id" }) @ApiProperty({ name: "checkout_session_id" })
  public readonly checkoutSessionId: string;

  @Expose({ name: "checkout_url" }) @ApiProperty({ name: "checkout_url", format: "uri", description: "Redirect the browser to this Stripe-hosted payment page" })
  public readonly checkoutUrl: string;

  public constructor(result: PlanSubscriptionResult) {
    this.checkoutSessionId = result.checkoutSessionId;
    this.checkoutUrl = result.checkoutUrl;
  }
}
