import { Exclude, Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { BuildDetails } from "@kumo/domain";

@Exclude()
export class BuildManifestDto {
  @Expose({ name: "dockerfile_path" }) @ApiProperty({ name: "dockerfile_path" }) public readonly dockerFilePath: string;
  @Expose({ name: "commit_sha" }) @ApiProperty({ name: "commit_sha" }) public readonly commitSha: string;
  @Expose() @ApiProperty() public readonly image: string;
  public constructor(build: BuildDetails) {
    this.dockerFilePath = build.dockerFilePath;
    this.commitSha = build.commitSha;
    this.image = build.image;
  }
}
