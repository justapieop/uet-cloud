import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import type { Deployment, DeploymentSpec, DeploymentStatus } from "@kumo/domain";
import { CreateDeploymentSpecDto } from "./CreateDeployment.dto.js";

export class DeploymentResponseDto {
  public constructor(deployment: Deployment) {
    this.id = deployment.id;
    this.userId = deployment.userId;
    this.name = deployment.name;
    this.status = deployment.status;
    this.spec = deployment.spec;
    this.fqdn = deployment.fqdn;
    this.errorMessage = deployment.errorMessage;
    this.createdAt = deployment.createdAt;
    this.updatedAt = deployment.updatedAt;
  }

  @ApiProperty({ example: "d9e847c1-2f3b-4c5a-b6d7-123456789abc" })
  public readonly id!: string;

  @Expose({ name: "user_id" })
  @ApiProperty({ name: "user_id", example: "user-123" })
  public readonly userId!: string;

  @ApiProperty({ example: "sample-app" })
  public readonly name!: string;

  @ApiProperty({ example: "RUNNING" })
  public readonly status!: DeploymentStatus;

  @ApiProperty({
    description: "Container deployment specification",
    type: CreateDeploymentSpecDto,
  })
  @Type((): typeof CreateDeploymentSpecDto => CreateDeploymentSpecDto)
  public readonly spec!: DeploymentSpec;

  @ApiPropertyOptional({
    example: "https://sample-app.internal.azurecontainerapps.io",
  })
  public readonly fqdn!: string | null;

  @Expose({ name: "error_message" })
  @ApiPropertyOptional({ name: "error_message" })
  public readonly errorMessage!: string | null;

  @Expose({ name: "created_at" })
  @ApiProperty({ name: "created_at" })
  public readonly createdAt!: Date;

  @Expose({ name: "updated_at" })
  @ApiProperty({ name: "updated_at" })
  public readonly updatedAt!: Date;
}
