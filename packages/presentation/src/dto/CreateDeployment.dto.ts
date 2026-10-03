import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class ResourcesDto {
  @ApiPropertyOptional({ example: "0.25", description: "CPU allocation" })
  @IsOptional()
  @IsString()
  public readonly cpu?: string;

  @ApiPropertyOptional({ example: "0.5Gi", description: "Memory allocation" })
  @IsOptional()
  @IsString()
  public readonly memory?: string;
}

export class ScalingDto {
  @ApiPropertyOptional({
    example: 0,
    default: 0,
    description: "Min replicas (0 for scale-to-zero)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly minReplicas?: number;

  @ApiPropertyOptional({
    example: 2,
    default: 2,
    description: "Max replicas",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly maxReplicas?: number;
}

export class CreateDeploymentSpecDto {
  @ApiProperty({
    description: "Docker container image URI",
    example: "nginxdemos/hello:latest",
  })
  @IsString()
  @IsNotEmpty()
  public readonly image!: string;

  @ApiProperty({
    description: "Target container port to expose",
    example: 80,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  public readonly targetPort!: number;

  @ApiPropertyOptional({ type: ResourcesDto })
  @IsOptional()
  @ValidateNested()
  @Type((): typeof ResourcesDto => ResourcesDto)
  public readonly resources?: ResourcesDto;

  @ApiPropertyOptional({ type: ScalingDto })
  @IsOptional()
  @ValidateNested()
  @Type((): typeof ScalingDto => ScalingDto)
  public readonly scaling?: ScalingDto;

  @ApiPropertyOptional({
    description: "Key-value environment variables",
    example: { NODE_ENV: "production" },
  })
  @IsOptional()
  @IsObject()
  public readonly envVars?: Record<string, string>;
}

export class CreateDeploymentDto {
  @ApiProperty({
    description: "Application name (2-32 lowercase alphanumeric characters or hyphens)",
    example: "sample-app",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/, {
    message:
      "name must be 2-32 lowercase alphanumeric characters or hyphens, starting with a letter and ending with an alphanumeric character",
  })
  public readonly name!: string;

  @ApiProperty({
    description: "Container deployment specification",
    type: CreateDeploymentSpecDto,
  })
  @ValidateNested()
  @Type((): typeof CreateDeploymentSpecDto => CreateDeploymentSpecDto)
  public readonly spec!: CreateDeploymentSpecDto;
}
