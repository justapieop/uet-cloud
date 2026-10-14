import { Build, type BuildDetails } from "@kumo/domain";
import { BuildNotFound, type BuildRepository, type PipelineBuildPort } from "../../ports/build.js";

export class GetBuildCase {
  public constructor(private readonly repository: BuildRepository, private readonly pipeline: PipelineBuildPort) {}
  public async exec(id: string, userId: string): Promise<BuildDetails> {
    const build: Build | null = await this.repository.findById(id);
    if (!build || build.getDetails().userId !== userId) throw new BuildNotFound("Build was not found");
    const details: BuildDetails = build.getDetails();
    if (!details.runId || ["SUCCEEDED", "FAILED", "CANCELED"].includes(details.status)) return details;
    const updated: BuildDetails = { ...details, ...await this.pipeline.getRun(details.runId), updatedAt: new Date() };
    await this.repository.save(new Build(updated));
    return updated;
  }
}
