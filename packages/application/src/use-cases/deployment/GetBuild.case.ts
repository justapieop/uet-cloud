import { Build, type BuildDetails } from "@kumo/domain";
import { BuildNotFound, type BuildWriteRepository, type PipelineBuildPort, type PipelineRun } from "../../ports/build.js";

export class GetBuildCase {
  private readonly inFlight: Map<string, Promise<BuildDetails>> = new Map();
  public constructor(private readonly repository: Pick<BuildWriteRepository, "findById" | "updateRun">, private readonly pipeline: PipelineBuildPort) {}
  public exec(id: string, userId: string): Promise<BuildDetails> {
    const key: string = JSON.stringify([userId, id]);
    const existing: Promise<BuildDetails> | undefined = this.inFlight.get(key);
    if (existing) return existing;
    const pending: Promise<BuildDetails> = this.refresh(id, userId).finally((): void => { this.inFlight.delete(key); });
    this.inFlight.set(key, pending);
    return pending;
  }
  private async refresh(id: string, userId: string): Promise<BuildDetails> {
    const build: Build | null = await this.repository.findById(id);
    if (!build || build.getDetails().userId !== userId) throw new BuildNotFound("Build was not found");
    const details: BuildDetails = build.getDetails();
    if (!details.runId || ["SUCCEEDED", "FAILED", "CANCELED"].includes(details.status)) return details;
    const run: PipelineRun = await this.pipeline.getRun(details.runId);
    if (run.status === details.status && run.runId === details.runId && run.runUrl === details.runUrl) return details;
    await this.repository.updateRun(id, userId, details.status, run);
    // Return the persisted winner if a concurrent instance completed this build first.
    const latest: Build | null = await this.repository.findById(id);
    if (!latest) throw new BuildNotFound("Build was not found");
    return latest.getDetails();
  }
}
