import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Build, type BuildDetails } from "@kumo/domain";
import { InvalidBuildInput, type BuildRepository, type BuildSourceInput, type PipelineBuildPort, type PipelineRun, type RepositoryBuildSourcePort, type TriggerBuildResult } from "../../ports/build.js";

export interface TriggerBuildInput extends BuildSourceInput {
  readonly imageName: string;
  readonly dockerFilePath?: string;
}

export class TriggerBuildCase {
  public constructor(
    private readonly source: RepositoryBuildSourcePort,
    private readonly pipeline: PipelineBuildPort,
    private readonly repository: BuildRepository,
  ) {}

  public async exec(input: TriggerBuildInput): Promise<TriggerBuildResult> {
    const dockerFilePath: string = input.dockerFilePath ?? "Dockerfile";
    if (
      !/^[0-9]+$/.test(input.userId) ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(input.imageName) || input.imageName.length > 128 ||
      !dockerFilePath || dockerFilePath.length > 1024 || dockerFilePath.startsWith("/") ||
      dockerFilePath.includes("\\") || dockerFilePath.includes(":") || dockerFilePath.includes("\0") ||
      dockerFilePath.split("/").includes("..") ||
      (input.ref !== undefined && (!input.ref.trim() || input.ref.length > 255))
    ) throw new InvalidBuildInput("Invalid build user, image name, Dockerfile path, or Git reference");

    const source: { commitSha: string } = await this.source.resolveBuildSource(input);
    const id: string = randomUUID();
    const sourceToken: string = randomBytes(32).toString("base64url");
    const now: Date = new Date();
    const details: BuildDetails = {
      id, userId: input.userId, repo: input.repo, commitSha: source.commitSha, dockerFilePath,
      image: this.pipeline.getImageAddress(input.userId, input.imageName, id),
      status: "PENDING", sourceTokenHash: createHash("sha256").update(sourceToken).digest("hex"),
      sourceExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      runId: null, runUrl: null, createdAt: now, updatedAt: now,
    };
    await this.repository.save(new Build(details));
    let run: PipelineRun;
    try {
      run = await this.pipeline.startBuild(id, sourceToken);
    } catch (error: unknown) {
      await this.repository.save(new Build({ ...details, status: "FAILED", updatedAt: new Date() }));
      throw error;
    }
    await this.repository.save(new Build({ ...details, ...run, updatedAt: new Date() }));
    return { ...run, buildId: id, image: details.image, commitSha: details.commitSha };
  }
}
