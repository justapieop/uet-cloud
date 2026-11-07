import { Exclude, Expose } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNumber, Max, Min } from "class-validator";
import { ApiProperty, PartialType } from "@nestjs/swagger";
import type { ScaleRule, ScaleRuleConfiguration, ScaleRuleDetails } from "@kumo/domain";

export class CreateScaleRuleDto {
  @ApiProperty({ default: false }) @IsBoolean() public enabled!: boolean;
  @ApiProperty({ enum: ["cpu"] }) @IsIn(["cpu"]) public metric!: "cpu";
  @ApiProperty({ description: "Percent of allocated vCPU, sustained in every one-minute bucket" }) @IsNumber() @Min(0) @Max(100) public scale_out_threshold!: number;
  @ApiProperty({ description: "Must be lower than scale_out_threshold" }) @IsNumber() @Min(0) @Max(100) public scale_in_threshold!: number;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) public min_replicas!: number;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) public max_replicas!: number;
  @ApiProperty({ description: "Whole minutes, from 120 to 1800 seconds" }) @IsInt() @Min(120) @Max(1800) public evaluation_window_seconds!: number;
  @ApiProperty({ minimum: 60, maximum: 86400 }) @IsInt() @Min(60) @Max(86400) public cooldown_seconds!: number;
}

export class UpdateScaleRuleDto extends PartialType(CreateScaleRuleDto, { skipNullProperties: false }) {}

export function scaleRuleConfiguration(dto: UpdateScaleRuleDto): Partial<ScaleRuleConfiguration> {
  // Select only mutable fields; clients cannot change binding or run metadata.
  return {
    ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
    ...(dto.metric !== undefined ? { metric: dto.metric } : {}),
    ...(dto.scale_out_threshold !== undefined ? { scaleOutThreshold: dto.scale_out_threshold } : {}),
    ...(dto.scale_in_threshold !== undefined ? { scaleInThreshold: dto.scale_in_threshold } : {}),
    ...(dto.min_replicas !== undefined ? { minReplicas: dto.min_replicas } : {}),
    ...(dto.max_replicas !== undefined ? { maxReplicas: dto.max_replicas } : {}),
    ...(dto.evaluation_window_seconds !== undefined ? { evaluationWindowSeconds: dto.evaluation_window_seconds } : {}),
    ...(dto.cooldown_seconds !== undefined ? { cooldownSeconds: dto.cooldown_seconds } : {}),
  };
}

@Exclude()
export class ScaleRuleResponseDto {
  @Expose({ name: "deployment_id" }) @ApiProperty({ name: "deployment_id" }) public readonly deploymentId: string;
  @Expose() @ApiProperty() public readonly enabled: boolean;
  @Expose() @ApiProperty({ enum: ["cpu"] }) public readonly metric: "cpu";
  @Expose({ name: "scale_out_threshold" }) @ApiProperty({ name: "scale_out_threshold" }) public readonly scaleOutThreshold: number;
  @Expose({ name: "scale_in_threshold" }) @ApiProperty({ name: "scale_in_threshold" }) public readonly scaleInThreshold: number;
  @Expose({ name: "min_replicas" }) @ApiProperty({ name: "min_replicas" }) public readonly minReplicas: number;
  @Expose({ name: "max_replicas" }) @ApiProperty({ name: "max_replicas" }) public readonly maxReplicas: number;
  @Expose({ name: "evaluation_window_seconds" }) @ApiProperty({ name: "evaluation_window_seconds" }) public readonly evaluationWindowSeconds: number;
  @Expose({ name: "cooldown_seconds" }) @ApiProperty({ name: "cooldown_seconds" }) public readonly cooldownSeconds: number;
  @Expose({ name: "created_at" }) @ApiProperty({ name: "created_at" }) public readonly createdAt: Date;
  @Expose({ name: "updated_at" }) @ApiProperty({ name: "updated_at" }) public readonly updatedAt: Date;
  @Expose({ name: "last_evaluated_at" }) @ApiProperty({ name: "last_evaluated_at", type: Date, nullable: true }) public readonly lastEvaluatedAt: Date | null;
  @Expose({ name: "last_scaled_at" }) @ApiProperty({ name: "last_scaled_at", type: Date, nullable: true }) public readonly lastScaledAt: Date | null;
  @Expose({ name: "last_action" }) @ApiProperty({ name: "last_action", enum: ["SCALE_OUT", "SCALE_IN", "NO_ACTION"] }) public readonly lastAction: ScaleRuleDetails["lastAction"];
  @Expose({ name: "last_reason" }) @ApiProperty({ name: "last_reason" }) public readonly lastReason: string;

  public constructor(rule: ScaleRule) {
    const details: ScaleRuleDetails = rule.getDetails();
    this.deploymentId = details.deploymentId; this.enabled = details.enabled; this.metric = details.metric;
    this.scaleOutThreshold = details.scaleOutThreshold; this.scaleInThreshold = details.scaleInThreshold;
    this.minReplicas = details.minReplicas; this.maxReplicas = details.maxReplicas;
    this.evaluationWindowSeconds = details.evaluationWindowSeconds; this.cooldownSeconds = details.cooldownSeconds;
    this.createdAt = details.createdAt; this.updatedAt = details.updatedAt;
    this.lastEvaluatedAt = details.lastEvaluatedAt; this.lastScaledAt = details.lastScaledAt;
    this.lastAction = details.lastAction; this.lastReason = details.lastReason;
  }
}
