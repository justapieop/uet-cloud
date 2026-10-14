import { Exclude, Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { TriggerBuildResult } from "@kumo/application";

@Exclude()
export class BuildResponseDto {
  @Expose({ name: "build_id" })
  @ApiProperty({ name: "build_id", format: "uuid" })
  public readonly buildId: string;

  @Expose({ name: "run_url" })
  @ApiProperty({ name: "run_url" })
  public readonly runUrl: string;
  @Expose({ name: "run_id" })
  @ApiProperty({ name: "run_id", example: "42" })
  public readonly runId: string;

  @Expose()
  @ApiProperty({ example: "QUEUED" })
  public readonly status: string;

  @Expose()
  @ApiProperty({ example: "registry.azurecr.io/kumo/123/my-app:unique-build-tag" })
  public readonly image: string;

  @Expose({ name: "commit_sha" })
  @ApiProperty({ name: "commit_sha" })
  public readonly commitSha: string;

  public constructor(result: TriggerBuildResult) {
    this.buildId = result.buildId;
    this.runUrl = result.runUrl;
    this.runId = result.runId;
    this.status = result.status;
    this.image = result.image;
    this.commitSha = result.commitSha;
  }
}
