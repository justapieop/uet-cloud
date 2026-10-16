import { Exclude, Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { BuildDetails } from "@kumo/domain";

@Exclude()
export class BuildManifestDto {
  @Expose({ name: "build_id" }) @ApiProperty({ name: "build_id", format: "uuid" }) public readonly buildId: string;
  @Expose({ name: "dockerfile_path" }) @ApiProperty({ name: "dockerfile_path" }) public readonly dockerFilePath: string;
  @Expose({ name: "commit_sha" }) @ApiProperty({ name: "commit_sha" }) public readonly commitSha: string;
  @Expose() @ApiProperty() public readonly image: string;
  public constructor(build: BuildDetails) {
    if (!build.commitSha) throw new Error("Build source is not prepared");
    this.buildId = build.id;
    this.dockerFilePath = build.dockerFilePath;
    this.commitSha = build.commitSha;
    this.image = build.image;
  }
}
