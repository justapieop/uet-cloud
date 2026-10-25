import { InvalidBuildInput } from "./ports/build.js";

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
  readonly ref?: string;
}

export function parseGitHubRepository(value: string): GitHubRepository {
  const input: string = value.trim();
  const normalized: string = input.startsWith("git@github.com:")
    ? input.replace("git@github.com:", "ssh://git@github.com/")
    : input;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new InvalidBuildInput("Provide a GitHub repository URL");
  }
  const validProtocol: boolean =
    (url.protocol === "https:" && !url.username) ||
    (url.protocol === "ssh:" && url.username === "git");
  const match: RegExpMatchArray | null = url.pathname.match(
    /^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)\/?$/,
  );
  if (!validProtocol || url.hostname !== "github.com" || url.port || url.password || url.search || !match) {
    throw new InvalidBuildInput("Provide a GitHub repository URL without credentials or query parameters");
  }
  const name: string = match[2].replace(/\.git$/, "");
  let ref: string | undefined;
  try {
    ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
  } catch {
    throw new InvalidBuildInput("Invalid Git reference in repository URL");
  }
  if (!name || name === "." || name === ".." || (ref !== undefined && (!ref.trim() || ref.includes(":")))) {
    throw new InvalidBuildInput("Invalid repository name or Git reference; use a Dockerfile path relative to the repository root");
  }
  return { owner: match[1], name, ref };
}

export function extractGitRepositoryName(value: string): string | null {
  try {
    return parseGitHubRepository(value).name;
  } catch {
    return null;
  }
}
