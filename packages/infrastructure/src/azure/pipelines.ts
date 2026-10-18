import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BuildProviderError, type PipelineBuildPort, type PipelineRun } from "@kumo/application";
import type { BuildStatus } from "@kumo/domain";
import { runBuildStep } from "../build-errors.js";
import type { AzureCredential, HttpTransport } from "../external-clients.js";

function redactPipelineMessage(message: string, sensitiveValues: readonly string[]): string {
  let redacted: string = message;
  for (let index: number = 0; index < sensitiveValues.length; index++) {
    const value: string = sensitiveValues[index]!;
    if (value) redacted = redacted.split(value).join("[redacted]");
  }
  return redacted
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,"'}]+/gi, "[credential redacted]")
    .replace(/[A-Za-z0-9_+\/.=-]{40,}/g, "[redacted]")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 800);
}

@Injectable()
export class AzurePipelinesProvider implements PipelineBuildPort {
  private readonly baseUrl: string;
  private readonly projectUrl: string;
  private readonly registry: string;
  private readonly pat: string | undefined;
  public constructor(
    config: ConfigService,
    private readonly credential: AzureCredential,
    private readonly http: HttpTransport,
  ) {
    const organization: string = config.getOrThrow<string>("AZURE_DEVOPS_ORGANIZATION");
    const project: string = config.getOrThrow<string>("AZURE_DEVOPS_PROJECT");
    const pipelineId: number = Number(config.getOrThrow<string>("AZURE_DEVOPS_PIPELINE_ID"));
    if (!/^[a-zA-Z0-9-]+$/.test(organization) || !project.trim() || !Number.isSafeInteger(pipelineId) || pipelineId <= 0) {
      throw new Error("Invalid Azure DevOps organization, project, or pipeline ID");
    }
    this.projectUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
    this.baseUrl = `${this.projectUrl}/_apis/pipelines/${pipelineId}/runs`;
    this.registry = config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_SERVER");
    if (!/^[a-zA-Z0-9.-]+$/.test(this.registry)) throw new Error("ACR server must be a hostname without a URL scheme or path");
    this.pat = config.get<string>("AZURE_DEVOPS_PAT") || undefined;
  }

  public getImageAddress(imageName: string, tag: string): string {
    return `${this.registry}/${imageName}:${tag}`;
  }

  public startBuild(buildId: string, sourceToken: string): Promise<PipelineRun> {
    return runBuildStep("Azure Pipeline scheduling", () => this.request("", {
      method: "POST",
      body: JSON.stringify({
        templateParameters: { buildId },
        variables: { kumoSourceToken: { value: sourceToken, isSecret: true } },
      }),
    }, [sourceToken]));
  }

  public getRun(runId: string): Promise<PipelineRun> {
    if (!/^[0-9]+$/.test(runId)) throw new BuildProviderError("Invalid pipeline run ID");
    return runBuildStep("Azure Pipeline status request", () => this.request(`/${runId}`, { method: "GET" }));
  }

  private async request(path: string, options: RequestInit, sensitiveValues: readonly string[] = []): Promise<PipelineRun> {
    let authorization: string;
    if (this.pat) {
      authorization = `Basic ${Buffer.from(`:${this.pat}`).toString("base64")}`;
    } else {
      const token: { token: string } | null = await this.credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
      if (!token) throw new BuildProviderError("Azure DevOps authentication did not return a token");
      authorization = `Bearer ${token.token}`;
    }
    const response: Response = await this.http(`${this.baseUrl}${path}?api-version=7.1`, {
      ...options,
      headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      let detail: string = "";
      try {
        const failure: unknown = await response.json();
        if (typeof failure === "object" && failure !== null && "message" in failure && typeof failure.message === "string") {
          detail = redactPipelineMessage(failure.message, [
            ...sensitiveValues, authorization, authorization.split(" ")[1] ?? "", this.pat ?? "",
          ]);
        }
      } catch {
        // Non-JSON responses may be proxy HTML; keep the HTTP status without exposing it.
      }
      throw new BuildProviderError(`Azure Pipeline request failed: HTTP ${response.status}${detail ? `; ${detail}` : ""}`);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new BuildProviderError("Azure DevOps returned an invalid run response"); }
    if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "number" || !Number.isSafeInteger(data.id) || data.id <= 0) {
      throw new BuildProviderError("Azure DevOps returned an invalid run response");
    }
    const state: unknown = "state" in data ? data.state : undefined;
    const result: unknown = "result" in data ? data.result : undefined;
    const status: BuildStatus = state === "completed"
      ? result === "succeeded" ? "SUCCEEDED" : result === "canceled" ? "CANCELED" : "FAILED"
      : state === "inProgress" || state === "canceling" ? "RUNNING" : "QUEUED";
    return { runId: String(data.id), runUrl: `${this.projectUrl}/_build/results?buildId=${data.id}`, status };
  }
}
