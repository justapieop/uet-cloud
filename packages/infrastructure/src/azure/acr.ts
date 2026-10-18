import type { ContainerRegistryTasksManagementClient, DockerBuildRequest, Run, SourceUploadDefinition } from "@azure/arm-containerregistrytasks";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BuildProviderError, type BuildRun, type BuildTriggerInput, type ContainerBuildPort } from "@kumo/application";
import { prepareBuildContext } from "./build-context.js";
import { runBuildStep } from "../build-errors.js";
import type { HttpTransport } from "../external-clients.js";

export { extractGitRepositoryName } from "../github/repository.js";

export interface AcrClient {
  readonly registries: Pick<ContainerRegistryTasksManagementClient["registries"], "getBuildSourceUploadUrl" | "scheduleRun">;
}

@Injectable()
export class AcrProvider implements ContainerBuildPort {
  private readonly registryServer: string;
  private readonly registryName: string;
  private readonly rgName: string;

  public constructor(
    config: ConfigService,
    private readonly acrManager: AcrClient,
    private readonly http: HttpTransport,
  ) {
    this.registryName = config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_NAME");
    this.registryServer = config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_SERVER");
    this.rgName = config.getOrThrow<string>("AZURE_RG_NAME");
  }

  public async triggerBuild(input: BuildTriggerInput): Promise<BuildRun> {
    const context: Buffer = await runBuildStep("Source archive preparation", () => prepareBuildContext(input.archive, input.dockerFilePath));
    const upload: SourceUploadDefinition = await runBuildStep("ACR build source upload URL request", () =>
      this.acrManager.registries.getBuildSourceUploadUrl(this.rgName, this.registryName),
    );
    if (!upload.uploadUrl || !upload.relativePath) {
      throw new BuildProviderError("Azure did not return a build source upload location");
    }
    const uploadUrl: string = upload.uploadUrl;
    const uploaded: Response = await runBuildStep("ACR source upload", () => this.http(uploadUrl, {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/octet-stream" },
      body: Uint8Array.from(context).buffer,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    }));
    if (!uploaded.ok) {
      throw new BuildProviderError(`ACR source upload failed: HTTP ${uploaded.status}`);
    }
    const image: string = `${this.registryServer}/${input.imageName}:${input.tag}`;
    const request: DockerBuildRequest = {
      type: "DockerBuildRequest",
      sourceLocation: upload.relativePath,
      dockerFilePath: input.dockerFilePath,
      imageNames: [image],
      isPushEnabled: true,
      credentials: { sourceRegistry: { identity: "[caller]", loginMode: "Default" } },
      platform: { os: "Linux", architecture: "amd64" },
      timeout: 1800,
    };
    const run: Run = await runBuildStep("ACR build scheduling", () => this.acrManager.registries.scheduleRun(this.rgName, this.registryName, request));
    const runId: string | undefined = run.properties?.runId;
    if (!runId) throw new BuildProviderError("Azure did not return a build run ID");
    return { runId, image, status: run.properties?.status ?? "Queued" };
  }
}
