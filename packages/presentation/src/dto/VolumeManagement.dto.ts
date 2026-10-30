import type { UserVolumeItem } from "@kumo/application";
import type { Volume } from "@kumo/domain";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class CreateStandaloneVolumeDto {
  @ApiProperty({ example: "shared-data", description: "Volume identifier name (2-32 lowercase alphanumeric or hyphens)" })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/)
  public name!: string;

  @ApiProperty({ example: 32, description: "Volume capacity in GiB (32 to 262,144 GiB)" })
  @IsInt()
  @Min(32)
  @Max(262144)
  public size_gb!: number;

  @ApiPropertyOptional({ example: "eastasia", description: "Target deployment region" })
  @IsOptional()
  @IsString()
  public region?: string;
}

@Exclude()
export class VolumeAttachedDeploymentDto {
  @Expose() @ApiProperty({ example: "00000000-0000-4000-8000-000000000001" }) public readonly id!: string;
  @Expose() @ApiProperty({ example: "my-app" }) public readonly name!: string;
}

@Exclude()
export class VolumeItemResponseDto {
  @Expose() @ApiProperty({ example: "00000000-0000-4000-8000-000000000001" }) public readonly id: string;
  @Expose() @ApiProperty({ example: "shared-data" }) public readonly name: string;
  @Expose({ name: "size_gb" }) @ApiProperty({ name: "size_gb", example: 5 }) public readonly sizeGb: number;
  @Expose() @ApiProperty({ example: "eastasia" }) public readonly region: string;
  @Expose({ name: "attached_deployments" })
  @ApiProperty({ name: "attached_deployments", type: [VolumeAttachedDeploymentDto] })
  public readonly attachedDeployments: readonly VolumeAttachedDeploymentDto[];
  @Expose({ name: "created_at" }) @ApiProperty({ name: "created_at" }) public readonly createdAt: string;
  @Expose({ name: "updated_at" }) @ApiProperty({ name: "updated_at" }) public readonly updatedAt: string;

  public constructor(item: UserVolumeItem | Volume, attachedDeployments?: readonly { readonly id: string; readonly name: string }[]) {
    if ("volume" in item) {
      this.id = item.volume.id;
      this.name = item.volume.name;
      this.sizeGb = item.volume.sizeGb;
      this.region = item.volume.region;
      this.attachedDeployments = item.attachedDeployments.map((d: { readonly id: string; readonly name: string }): VolumeAttachedDeploymentDto => ({
        id: d.id,
        name: d.name,
      }));
      this.createdAt = item.volume.createdAt.toISOString();
      this.updatedAt = item.volume.updatedAt.toISOString();
    } else {
      this.id = item.id;
      this.name = item.name;
      this.sizeGb = item.sizeGb;
      this.region = item.region;
      this.attachedDeployments = (attachedDeployments ?? []).map((d: { readonly id: string; readonly name: string }): VolumeAttachedDeploymentDto => ({
        id: d.id,
        name: d.name,
      }));
      this.createdAt = item.createdAt.toISOString();
      this.updatedAt = item.updatedAt.toISOString();
    }
  }
}
