import type { components } from "@kumo/rest";

export type GitHubRepository = components["schemas"]["GitHubRepositoryResponseDto"];
export type GitHubRepositoryPage = components["schemas"]["GitHubRepositoriesResponseDto"];
export type RepositoryResult =
  | { readonly data: GitHubRepositoryPage; readonly error?: never }
  | { readonly error: string; readonly data?: never };
