import { Exclude, Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { DeploymentRegion } from "@kumo/application";

@Exclude()
export class DeploymentRegionResponseDto {
  @Expose() @ApiProperty({ example: "japaneast", description: "Value accepted by deployment creation's region field" }) public readonly name: string;
  @Expose({ name: "display_name" }) @ApiProperty({ name: "display_name", example: "Japan East" }) public readonly displayName: string;

  public constructor(region: DeploymentRegion) {
    this.name = region.name;
    this.displayName = region.displayName;
  }
}
