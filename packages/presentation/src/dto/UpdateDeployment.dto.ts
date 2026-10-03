import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ResourcesDto, ScalingDto } from "./CreateDeployment.dto.js";

export class UpdateDeploymentSpecDto {
  @ApiPropertyOptional({
    description: "Updated container image URI",
    example: "nginxdemos/hello:0.3",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public readonly image?: string;

  @ApiPropertyOptional({
    description: "Updated target container port",
    example: 80,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  public readonly targetPort?: number;

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
    description: "Updated environment variables",
    example: { DEBUG: "false" },
  })
  @IsOptional()
  @IsObject()
  public readonly envVars?: Record<string, string>;
}

export class UpdateDeploymentDto {
  @ApiPropertyOptional({
    description: "Updated container deployment specification",
    type: UpdateDeploymentSpecDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type((): typeof UpdateDeploymentSpecDto => UpdateDeploymentSpecDto)
  public readonly spec?: UpdateDeploymentSpecDto;
}
