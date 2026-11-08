import type { DeploymentResourceConfigurationDetails, DeploymentResourceUpdate, DeploymentResourceUpdateReceipt, DeploymentResourceUpdateStatus } from "@kumo/domain";
import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import { IsInt, IsNumber, Min } from "class-validator";

export class UpdateDeploymentResourcesDto {
  @ApiProperty({ example: 1, description: "vCPU per replica, in positive increments of 0.25" })
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.25)
  public max_vcpu!: number;

  @ApiProperty({ example: 2, description: "GiB per replica; exactly twice max_vcpu" })
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.5)
  public max_memory!: number;

  @ApiProperty({ example: 0 }) @IsInt() @Min(0)
  public min_scaling!: number;

  @ApiProperty({ example: 3, description: "At least min_scaling" }) @IsInt() @Min(1)
  public max_scaling!: number;
}

@Exclude()
export class DeploymentResourceConfigurationDto {
  @Expose({ name: "max_vcpu" }) @ApiProperty({ name: "max_vcpu" }) public readonly maxVcpu: number;
  @Expose({ name: "max_memory" }) @ApiProperty({ name: "max_memory" }) public readonly maxMemory: number;
  @Expose({ name: "min_scaling" }) @ApiProperty({ name: "min_scaling" }) public readonly minScaling: number;
  @Expose({ name: "max_scaling" }) @ApiProperty({ name: "max_scaling" }) public readonly maxScaling: number;
  public constructor(configuration: DeploymentResourceConfigurationDetails) {
    this.maxVcpu = configuration.maxVcpu;
    this.maxMemory = configuration.maxMemory;
    this.minScaling = configuration.minScaling;
    this.maxScaling = configuration.maxScaling;
  }
}

@Exclude()
export class DeploymentResourceUpdateReceiptDto {
  @Expose({ name: "operation_id" }) @ApiProperty({ name: "operation_id", format: "uuid" }) public readonly operationId: string;
  @Expose({ name: "deployment_id" }) @ApiProperty({ name: "deployment_id", format: "uuid" }) public readonly deploymentId: string;
  @Expose() @ApiProperty({ enum: ["PENDING"] }) public readonly status: "PENDING";
  @Expose() @ApiProperty({ type: DeploymentResourceConfigurationDto }) public readonly requested: DeploymentResourceConfigurationDto;
  public constructor(receipt: DeploymentResourceUpdateReceipt) {
    this.operationId = receipt.operationId;
    this.deploymentId = receipt.deploymentId;
    this.status = receipt.status;
    this.requested = new DeploymentResourceConfigurationDto(receipt.requested);
  }
}

@Exclude()
export class DeploymentResourceUpdateResponseDto {
  @Expose({ name: "operation_id" }) @ApiProperty({ name: "operation_id", format: "uuid" }) public readonly operationId: string;
  @Expose({ name: "deployment_id" }) @ApiProperty({ name: "deployment_id", format: "uuid" }) public readonly deploymentId: string;
  @Expose() @ApiProperty({ enum: ["PENDING", "APPLYING", "RECONCILING", "SUCCEEDED", "FAILED"] }) public readonly status: DeploymentResourceUpdateStatus;
  @Expose() @ApiProperty({ type: DeploymentResourceConfigurationDto }) public readonly requested: DeploymentResourceConfigurationDto;
  @Expose() @ApiProperty({ type: DeploymentResourceConfigurationDto, nullable: true, description: "Observed template resources; success also requires verification of the serving target revision" }) public readonly observed: DeploymentResourceConfigurationDto | null;
  @Expose({ name: "no_op" }) @ApiProperty({ name: "no_op", type: Boolean, nullable: true }) public readonly noOp: boolean | null;
  @Expose({ name: "target_revision" }) @ApiProperty({ name: "target_revision", type: String, nullable: true }) public readonly targetRevision: string | null;
  @Expose({ name: "error_code" }) @ApiProperty({ name: "error_code", type: String, nullable: true }) public readonly errorCode: string | null;
  @Expose({ name: "error_message" }) @ApiProperty({ name: "error_message", type: String, nullable: true }) public readonly errorMessage: string | null;
  @Expose({ name: "created_at" }) @ApiProperty({ name: "created_at", type: Date }) public readonly createdAt: Date;
  @Expose({ name: "started_at" }) @ApiProperty({ name: "started_at", type: Date, nullable: true }) public readonly startedAt: Date | null;
  @Expose({ name: "completed_at" }) @ApiProperty({ name: "completed_at", type: Date, nullable: true }) public readonly completedAt: Date | null;
  public constructor(update: DeploymentResourceUpdate) {
    this.operationId = update.id;
    this.deploymentId = update.deploymentId;
    this.status = update.status;
    this.requested = new DeploymentResourceConfigurationDto(update.requested);
    this.observed = update.observed ? new DeploymentResourceConfigurationDto(update.observed) : null;
    this.noOp = update.noOp;
    this.targetRevision = update.targetRevision;
    this.errorCode = update.errorCode;
    this.errorMessage = update.errorMessage;
    this.createdAt = update.createdAt;
    this.startedAt = update.startedAt;
    this.completedAt = update.completedAt;
  }
}
