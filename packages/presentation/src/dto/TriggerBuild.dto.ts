import { Expose } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TriggerBuildDto {
  @ApiProperty({ example: "https://github.com/owner/private-app.git", description: "GitHub repository URL; an optional #ref selects a branch or commit" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  public readonly repo!: string;

  @Expose({
    name: "image_name",
  })
  @ApiProperty({ name: "image_name", example: "my-app" })
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  @MaxLength(128)
  public readonly imageName!: string;

  @Expose({ name: "dockerfile_path" })
  @ApiPropertyOptional({ name: "dockerfile_path", example: "Dockerfile", default: "Dockerfile", description: "Path relative to the repository root" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  public readonly dockerFilePath?: string;

  @ApiPropertyOptional({ example: "main", description: "Branch, tag, or commit; overrides the URL fragment, otherwise uses the default branch" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  public readonly ref?: string;
}

