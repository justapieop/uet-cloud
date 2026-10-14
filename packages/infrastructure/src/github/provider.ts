import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KmsProvider } from "../azure/kms.js";
import { BuildAccessDenied, BuildProviderError, InvalidBuildInput, type BuildSource, type BuildSourceInput, type RepositoryBuildSourcePort } from "@kumo/application";
import { parseGitHubRepository, type GitHubRepository } from "./repository.js";
import { runBuildStep } from "../build-errors.js";

const GITHUB_API_VERSION: string = "2026-03-10";
const REQUEST_TIMEOUT_MS: number = 30_000;

@Injectable()
export class GitHubProvider implements RepositoryBuildSourcePort {
  private readonly clientId: string;
  private readonly keyName: string;

  public constructor(
    private readonly kmsClient: KmsProvider,
    configService: ConfigService,
  ) {
    this.clientId = configService.get<string>("GITHUB_APP_CLIENT_ID")
      ?? configService.getOrThrow<string>("GITHUB_OAUTH2_CLIENT_ID");
    this.keyName = configService.getOrThrow<string>("GITHUB_APP_PRIVATE_KEY_NAME");
  }

  public async getRepositoryAccessToken(
    owner: string,
    repo: string,
  ): Promise<string> {
    return runBuildStep("GitHub installation token request", () => this.requestRepositoryAccessToken(owner, repo));
  }

  private async requestRepositoryAccessToken(owner: string, repo: string): Promise<string> {
    if (
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === ".."
    ) {
      throw new InvalidBuildInput("Provide a valid GitHub repository owner and name");
    }

    const now: number = Math.floor(Date.now() / 1000);
    const header: string = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ).toString("base64url");
    const payload: string = Buffer.from(
      JSON.stringify({ iss: this.clientId, iat: now - 60, exp: now + 540 }),
    ).toString("base64url");
    const signingInput: string = `${header}.${payload}`;
    const signature: string = await this.kmsClient.sign({
      data: signingInput,
      keyName: this.keyName,
    });
    const jwt: string = `${signingInput}.${signature}`;

    const installationResponse: Response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "kumo",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!installationResponse.ok) {
      throw new BuildProviderError(`GitHub repository installation lookup failed: HTTP ${installationResponse.status}`);
    }

    let installation: unknown;
    try {
      installation = await installationResponse.json();
    } catch {
      throw new BuildProviderError("GitHub returned an invalid repository installation response");
    }

    if (
      typeof installation !== "object" || installation === null ||
      !("id" in installation) || typeof installation.id !== "number" ||
      !Number.isSafeInteger(installation.id) || installation.id <= 0
    ) {
      throw new BuildProviderError("GitHub returned an invalid repository installation response");
    }
    const installationId: number = installation.id;

    const response: Response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "kumo",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        body: JSON.stringify({
          repositories: [repo],
          permissions: { contents: "read" },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new BuildProviderError(`GitHub installation token request failed: HTTP ${response.status}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new BuildProviderError("GitHub returned an invalid installation token response");
    }

    if (
      typeof data !== "object" || data === null ||
      !("token" in data) || typeof data.token !== "string" || !data.token.trim() ||
      !("expires_at" in data) || typeof data.expires_at !== "string" ||
      !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= Date.now()
    ) {
      throw new BuildProviderError("GitHub returned an invalid installation token response");
    }

    return data.token;
  }

  public async downloadBuildSource(input: BuildSourceInput): Promise<BuildSource> {
    return runBuildStep("GitHub source download", () => this.prepareBuildSource(input));
  }

  public async resolveBuildSource(input: BuildSourceInput): Promise<{ commitSha: string }> {
    const source: { token: string; repoPath: string; commitSha: string } = await runBuildStep("GitHub commit resolution", () => this.resolveAuthorizedSource(input));
    return { commitSha: source.commitSha };
  }

  private async resolveAuthorizedSource(input: BuildSourceInput): Promise<{ token: string; repoPath: string; commitSha: string }> {
    const repository: GitHubRepository = parseGitHubRepository(input.repo);
    const token: string = await this.getRepositoryAccessToken(repository.owner, repository.name);
    const repoPath: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

    // The installation can access more repositories than the requesting user.
    const user: unknown = await this.getJson(`/user/${encodeURIComponent(input.userId)}`, token);
    if (typeof user !== "object" || user === null || !("login" in user) || typeof user.login !== "string") {
      throw new BuildProviderError("GitHub returned an invalid user response");
    }
    const access: Response = await this.githubRequest(`${repoPath}/collaborators/${encodeURIComponent(user.login)}`, token);
    if (access.status === 404) {
      throw new BuildAccessDenied("The current user does not have access to this repository");
    }
    if (access.status !== 204) {
      throw new BuildProviderError(`GitHub repository access check failed: HTTP ${access.status}`);
    }

    const ref: string = input.ref ?? repository.ref ?? "HEAD";
    const commit: unknown = await this.getJson(`${repoPath}/commits/${encodeURIComponent(ref)}`, token);
    if (typeof commit !== "object" || commit === null || !("sha" in commit) || typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
      throw new BuildProviderError("GitHub returned an invalid commit response");
    }
    return { token, repoPath, commitSha: commit.sha };
  }

  private async prepareBuildSource(input: BuildSourceInput): Promise<BuildSource> {
    const source: { token: string; repoPath: string; commitSha: string } = await this.resolveAuthorizedSource(input);
    const redirect: Response = await this.githubRequest(`${source.repoPath}/tarball/${source.commitSha}`, source.token);
    const location: string | null = redirect.headers.get("location");
    if (redirect.status !== 302 || !location) {
      throw new BuildProviderError(`GitHub archive download failed: HTTP ${redirect.status}`);
    }
    const downloadUrl: URL = new URL(location);
    if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== "codeload.github.com" || downloadUrl.username || downloadUrl.password || downloadUrl.port) {
      throw new BuildProviderError("GitHub returned an unexpected archive download location");
    }
    // Do not forward the GitHub token to the redirected archive host.
    const response: Response = await fetch(downloadUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) {
      throw new BuildProviderError(`GitHub archive download failed: HTTP ${response.status}`);
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size: number = 0;
    try {
      while (true) {
        const chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>> = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 100 * 1024 * 1024) {
          await reader.cancel();
          throw new BuildProviderError("Repository archive exceeds the 100 MiB build source limit");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return { archive: Buffer.concat(chunks), commitSha: source.commitSha };
  }

  private githubRequest(path: string, token: string): Promise<Response> {
    return fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "kumo",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async getJson(path: string, token: string): Promise<unknown> {
    const response: Response = await this.githubRequest(path, token);
    if (!response.ok) {
      throw new BuildProviderError(`GitHub source request failed: HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new BuildProviderError("GitHub returned an invalid source response");
    }
  }
}
