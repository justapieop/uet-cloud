import { ApiProperty } from "@nestjs/swagger";
import { Expose } from "class-transformer";
import type { DeleteUserResourceGroupResult } from "@kumo/application";

export class DeleteResourceGroupResponseDto {
  public constructor(result: DeleteUserResourceGroupResult) {
    this.resourceGroupName = result.resourceGroupName;
    this.status = result.status;
    this.deploymentsSynchronized = result.deploymentsSynchronized;
  }

  @Expose({ name: "resource_group_name" })
  @ApiProperty({ name: "resource_group_name", example: "user-rg-dev01" })
  public readonly resourceGroupName!: string;

  @ApiProperty({ example: "DELETED" })
  public readonly status!: "DELETED";

  @Expose({ name: "deployments_synchronized" })
  @ApiProperty({ name: "deployments_synchronized", example: 2 })
  public readonly deploymentsSynchronized!: number;
}
