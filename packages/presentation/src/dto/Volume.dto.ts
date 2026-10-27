import type { DeploymentVolume, VolumeAccessMode } from "@kumo/domain";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from "class-validator";

export class DeploymentVolumeDto {
  @ApiProperty({ example: "data", description: "Volume identifier name (2-32 lowercase letters, digits, or hyphens)" })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/)
  public name!: string;

  @ApiProperty({ example: "/var/data", description: "Mount path inside the container" })
  @IsString()
  @Matches(/^\/[a-zA-Z0-9_./-]+$/)
  public mount_path!: string;

  @ApiPropertyOptional({ example: "subfolder", description: "Relative subpath within the file share" })
  @IsOptional()
  @IsString()
  public sub_path?: string;

  @ApiProperty({ example: 5, description: "Volume capacity in GiB" })
  @IsInt()
  @Min(1)
  public size_gb!: number;

  @ApiPropertyOptional({ enum: ["ReadWrite", "ReadOnly"], default: "ReadWrite" })
  @IsOptional()
  @IsIn(["ReadWrite", "ReadOnly"])
  public access_mode?: VolumeAccessMode;
}

@Exclude()
export class DeploymentVolumeResponseDto {
  @Expose() @ApiProperty() public readonly name: string;
  @Expose({ name: "mount_path" }) @ApiProperty({ name: "mount_path" }) public readonly mountPath: string;
  @Expose({ name: "sub_path" }) @ApiPropertyOptional({ name: "sub_path" }) public readonly subPath?: string;
  @Expose({ name: "size_gb" }) @ApiProperty({ name: "size_gb" }) public readonly sizeGb: number;
  @Expose({ name: "access_mode" }) @ApiProperty({ name: "access_mode", enum: ["ReadWrite", "ReadOnly"] }) public readonly accessMode: VolumeAccessMode;

  public constructor(volume: DeploymentVolume) {
    this.name = volume.name;
    this.mountPath = volume.mountPath;
    this.subPath = volume.subPath;
    this.sizeGb = volume.sizeGb;
    this.accessMode = volume.accessMode ?? "ReadWrite";
  }
}
