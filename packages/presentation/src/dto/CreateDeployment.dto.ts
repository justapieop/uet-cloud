import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class ResourcesDto {
  @ApiPropertyOptional({ example: 0.25, description: "CPU allocation (in cores, e.g. 0.25, 0.5, 1)" })
  @IsOptional()
  @IsNumber()
  public readonly cpu?: number;

  @ApiPropertyOptional({ example: 0.5, description: "Memory allocation in GiB (e.g. 0.5, 1, 2)" })
  @IsOptional()
  @IsNumber()
  public readonly memory?: number;
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
    example: "mcr.microsoft.com/k8se/quickstart:latest",
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
