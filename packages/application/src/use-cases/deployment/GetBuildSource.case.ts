import { createHash, timingSafeEqual } from "node:crypto";
import type { Build, BuildDetails } from "@kumo/domain";
import { BuildAccessDenied, type BuildRepository, type BuildSource, type BuildSourcePort, type SourceArchivePort } from "../../ports/build.js";

export class GetBuildSourceCase {
  public constructor(private readonly repository: BuildRepository, private readonly source: BuildSourcePort, private readonly archive: SourceArchivePort) {}

  public async authorize(id: string, token: string): Promise<BuildDetails> {
    const build: Build | null = await this.repository.findById(id);
    if (!build || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BuildAccessDenied("Invalid build source credential");
    const details: BuildDetails = build.getDetails();
    const provided: Buffer = createHash("sha256").update(token).digest();
    const stored: Buffer = Buffer.from(details.sourceTokenHash, "hex");
    if (!details.commitSha || !timingSafeEqual(provided, stored) || details.sourceExpiresAt.getTime() <= Date.now() || ["SUCCEEDED", "FAILED", "CANCELED"].includes(details.status)) {
      throw new BuildAccessDenied("Invalid or expired build source credential");
    }
    return details;
  }

  public async exec(id: string, token: string): Promise<Uint8Array> {
    const details: BuildDetails = await this.authorize(id, token);
    const source: BuildSource = await this.source.downloadBuildSource({ userId: details.userId, repo: details.repo, ref: details.commitSha! });
    return this.archive.prepare(source.archive, details.dockerFilePath);
  }
}
