import type { DeploymentStatus } from "@kumo/domain";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, type TransformFnParams } from "class-transformer";
import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

function trimQueryValue({ value }: TransformFnParams): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export class ListDeploymentsQueryDto {
  @ApiPropertyOptional({ enum: ["PENDING", "PROVISIONING", "RUNNING", "STOPPED", "FAILED", "DELETED"], description: "Filter by deployment status" })
  @ValidateIf((_input: ListDeploymentsQueryDto, value: unknown): boolean => value !== undefined)
  @Transform(trimQueryValue)
  @IsString()
  @IsIn(["PENDING", "PROVISIONING", "RUNNING", "STOPPED", "FAILED", "DELETED"])
  public status?: DeploymentStatus;

  @ApiPropertyOptional({ maxLength: 32, description: "Case-insensitive literal substring of the deployment name" })
  @ValidateIf((_input: ListDeploymentsQueryDto, value: unknown): boolean => value !== undefined)
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public name?: string;

  @ApiPropertyOptional({ example: "japaneast", description: "Exact requested region saved on the deployment" })
  @ValidateIf((_input: ListDeploymentsQueryDto, value: unknown): boolean => value !== undefined)
  @Transform(trimQueryValue)
  @IsString()
  @Matches(/^[a-z][a-z0-9]{0,63}$/)
  public region?: string;
}
