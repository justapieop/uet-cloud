import { Expose } from "class-transformer";


export class UserResponseDto {
  public readonly id!: string;

  @Expose({ name: "display_name", })
  public readonly displayName!: string;

  public readonly createdAt!: Date;

  public readonly suspended!: boolean;
}