import { createHash, randomBytes } from "node:crypto";
import { Build, type BuildDetails } from "@kumo/domain";
import { BuildAccessDenied, BuildProviderError, InvalidBuildInput, type BuildWriteRepository, type PipelineBuildPort, type PipelineRun, type RepositoryBuildSourcePort } from "../../ports/build.js";

export class ProcessBuildCase {
  public constructor(
    private readonly source: RepositoryBuildSourcePort,
    private readonly pipeline: PipelineBuildPort,
    private readonly repository: Pick<BuildWriteRepository, "update">,
  ) {}

  public async exec(build: Build): Promise<void> {
    let details: BuildDetails = build.getDetails();
    if (details.status !== "PREPARING") throw new Error("Build must be claimed before processing");
    try {
      const source: { commitSha: string } = await this.source.resolveBuildSource({
        userId: details.userId, repo: details.repo, ref: details.ref ?? undefined,
      });
      if (!/^[a-f0-9]{40}$/i.test(source.commitSha)) throw new InvalidBuildInput("Invalid resolved Git commit SHA");
      const commitSha: string = source.commitSha.toLowerCase();
      // Strip legacy queued tags too: only the resolved source commit selects the image tag.
      const image: string = `${details.image.replace(/:[^/]*$/, "")}:${commitSha}`;
      const token: string = randomBytes(32).toString("base64url");
      const now: Date = new Date();
      details = {
        ...details, commitSha, image,
        sourceTokenHash: createHash("sha256").update(token).digest("hex"),
        sourceExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), updatedAt: now,
      };
      // The source endpoints can be called as soon as Azure accepts the run.
      await this.repository.update(new Build(details));
      const run: PipelineRun = await this.pipeline.startBuild(details.id, token);
      await this.repository.update(new Build({ ...details, ...run, updatedAt: new Date() }));
    } catch (error: unknown) {
      const message: string = error instanceof BuildProviderError || error instanceof BuildAccessDenied || error instanceof InvalidBuildInput
        ? error.message.slice(0, 2048) : "Build preparation or scheduling failed";
      await this.repository.update(new Build({ ...details, status: "FAILED", error: message, updatedAt: new Date() }));
    }
  }
}
