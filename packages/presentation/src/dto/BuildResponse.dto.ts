import { Exclude, Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { TriggerBuildResult } from "@kumo/application";

@Exclude()
export class BuildResponseDto {
  @Expose({ name: "build_id" })
  @ApiProperty({ name: "build_id", format: "uuid" })
  public readonly buildId: string;

  @Expose({ name: "run_url" })
  @ApiProperty({ name: "run_url", type: String, nullable: true })
  public readonly runUrl: string | null;
  @Expose({ name: "run_id" })
  @ApiProperty({ name: "run_id", type: String, nullable: true, example: "42" })
  public readonly runId: string | null;

  @Expose()
  @ApiProperty({ example: "PENDING", enum: ["PENDING", "PREPARING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"] })
  public readonly status: string;

  @Expose()
  @ApiProperty({ example: "registry.azurecr.io/my-app:v1.2.3" })
  public readonly image: string;

  @Expose({ name: "commit_sha" })
  @ApiProperty({ name: "commit_sha", type: String, nullable: true })
  public readonly commitSha: string | null;

  @Expose()
  @ApiProperty({ type: String, nullable: true, description: "Preparation or scheduling failure; null when none has been recorded" })
  public readonly error: string | null;

  public constructor(result: TriggerBuildResult) {
    this.buildId = result.buildId;
    this.runUrl = result.runUrl;
    this.runId = result.runId;
    this.status = result.status;
    this.image = result.image;
    this.commitSha = result.commitSha;
    this.error = result.error ?? null;
  }
}
