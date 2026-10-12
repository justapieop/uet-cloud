import { Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { User } from "@kumo/domain";

export class UserResponseDto {
  public constructor(user: User) {
    this.id = user.id;
    this.displayName = user.displayName;
    this.createdAt = user.createdAt;
    this.suspended = user.suspended;
  }

  @ApiProperty()
  public readonly id!: string;

  @Expose({ name: "display_name", })
  @ApiProperty({ name: "display_name", })
  public readonly displayName!: string;

  @Expose({ name: "created_at", })
  @ApiProperty({ name: "created_at", })
  public readonly createdAt!: Date;

  @ApiProperty()
  public readonly suspended!: boolean;
}
