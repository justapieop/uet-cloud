import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Exclude, Expose, Type } from "class-transformer";
import { IsBoolean, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import type { Plan, PlanDetails } from "@kumo/domain";
import type { AdminSubscription, AdminSubscriptionPage } from "@kumo/application";
import { PlanResponseDto } from "./Plan.dto.js";

export class AdminPlanWriteDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(255) public name!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(999999999999999) public price!: number;
  @ApiProperty() @IsNumber() @Min(0.25) public vcpu!: number;
  @ApiProperty() @IsNumber() @Min(0.5) public memory!: number;
  @ApiProperty() @IsInt() @Min(1) public deployments!: number;
  @ApiProperty() @IsInt() @Min(1) public disk!: number;
  @ApiProperty() @IsBoolean() public active!: boolean;
  @ApiProperty({ type: String, nullable: true }) @ValidateIf((_dto: AdminPlanWriteDto, value: unknown): boolean => value !== null)
  @IsString() @Matches(/^prod_[A-Za-z0-9]+$/) @MaxLength(255) public stripe_product_id!: string | null;
  @ApiProperty() @IsInt() @Min(1) public max_replicas!: number;

  public details(id: string): PlanDetails {
    return { id, name: this.name, price: this.price, vcpu: this.vcpu, memory: this.memory, deployments: this.deployments,
      disk: this.disk, active: this.active, stripeProductId: this.stripe_product_id, maxReplicas: this.max_replicas };
  }
}

export class AdminPlanCreateDto extends AdminPlanWriteDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(255) public id!: string;
}

export class AdminPlanQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) public page: number = 1;
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) public per_page: number = 30;
}

@Exclude()
export class AdminPlanResponseDto extends PlanResponseDto {
  @Expose() @ApiProperty() public readonly active: boolean;
  @Expose({ name: "stripe_product_id" }) @ApiProperty({ name: "stripe_product_id", type: String, nullable: true }) public readonly stripeProductId: string | null;
  public constructor(plan: Plan) { super(plan); this.active = plan.active; this.stripeProductId = plan.stripeProductId; }
}

@Exclude()
export class AdminPlanPageDto {
  @Expose() @Type(() => AdminPlanResponseDto) @ApiProperty({ type: [AdminPlanResponseDto] }) public readonly plans: AdminPlanResponseDto[];
  @Expose() @ApiProperty() public readonly page: number;
  @Expose({ name: "per_page" }) @ApiProperty({ name: "per_page" }) public readonly perPage: number;
  @Expose({ name: "has_next_page" }) @ApiProperty({ name: "has_next_page" }) public readonly hasNextPage: boolean;
  public constructor(plans: Plan[], page: number, perPage: number, hasNextPage: boolean) {
    this.plans = plans.map((plan: Plan): AdminPlanResponseDto => new AdminPlanResponseDto(plan)); this.page = page; this.perPage = perPage; this.hasNextPage = hasNextPage;
  }
}

export class AdminSubscriptionQueryDto {
  @ApiPropertyOptional({ default: 30, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) public limit: number = 30;
  @ApiPropertyOptional() @ValidateIf((_dto: AdminSubscriptionQueryDto, value: unknown): boolean => value !== undefined)
  @IsString() @Matches(/^sub_[A-Za-z0-9]+$/) @MaxLength(255) public starting_after?: string;
}

export class AdminCancellationDto {
  @ApiProperty({ description: "true schedules cancellation at period end; false undoes a scheduled cancellation" }) @IsBoolean() public cancel_at_period_end!: boolean;
}

@Exclude()
export class AdminSubscriptionItemDto {
  @Expose({ name: "price_id" }) @ApiProperty({ name: "price_id" }) public readonly priceId: string;
  @Expose({ name: "product_id" }) @ApiProperty({ name: "product_id" }) public readonly productId: string;
  public constructor(item: { priceId: string; productId: string }) { this.priceId = item.priceId; this.productId = item.productId; }
}

@Exclude()
export class AdminSubscriptionResponseDto {
  @Expose() @ApiProperty() public readonly id: string;
  @Expose() @ApiProperty() public readonly status: string;
  @Expose({ name: "cancel_at_period_end" }) @ApiProperty({ name: "cancel_at_period_end" }) public readonly cancelAtPeriodEnd: boolean;
  @Expose({ name: "cancel_at" }) @ApiProperty({ name: "cancel_at", type: Number, nullable: true, description: "Unix timestamp from Stripe" }) public readonly cancelAt: number | null;
  @Expose() @Type(() => AdminSubscriptionItemDto) @ApiProperty({ type: [AdminSubscriptionItemDto] }) public readonly items: AdminSubscriptionItemDto[];
  public constructor(subscription: AdminSubscription) {
    this.id = subscription.id; this.status = subscription.status; this.cancelAtPeriodEnd = subscription.cancelAtPeriodEnd; this.cancelAt = subscription.cancelAt;
    this.items = subscription.items.map((item: { priceId: string; productId: string }): AdminSubscriptionItemDto => new AdminSubscriptionItemDto(item));
  }
}

@Exclude()
export class AdminSubscriptionPageDto {
  @Expose() @Type(() => AdminSubscriptionResponseDto) @ApiProperty({ type: [AdminSubscriptionResponseDto] }) public readonly subscriptions: AdminSubscriptionResponseDto[];
  @Expose({ name: "has_more" }) @ApiProperty({ name: "has_more" }) public readonly hasMore: boolean;
  @Expose({ name: "next_cursor" }) @ApiProperty({ name: "next_cursor", type: String, nullable: true }) public readonly nextCursor: string | null;
  public constructor(result: AdminSubscriptionPage) {
    this.subscriptions = result.subscriptions.map((subscription: AdminSubscription): AdminSubscriptionResponseDto => new AdminSubscriptionResponseDto(subscription));
    this.hasMore = result.hasMore; this.nextCursor = result.nextCursor;
  }
}
