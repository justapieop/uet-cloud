import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class RootLoginDto {
  @ApiProperty({ type: String, format: "password", writeOnly: true, minLength: 1, maxLength: 1024 })
  @IsString() @MinLength(1) @MaxLength(1024)
  public password!: string;
}
