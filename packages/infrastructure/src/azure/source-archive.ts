import { Injectable } from "@nestjs/common";
import type { SourceArchivePort } from "@kumo/application";
import { prepareBuildContext } from "./build-context.js";
import { runBuildStep } from "../build-errors.js";

@Injectable()
export class SourceArchiveProvider implements SourceArchivePort {
  public prepare(archive: Uint8Array, dockerFilePath: string): Promise<Uint8Array> {
    return runBuildStep("Source archive preparation", () => prepareBuildContext(archive, dockerFilePath));
  }
}
