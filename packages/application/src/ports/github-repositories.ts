export interface InstalledGitHubRepository {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string | null;
}

export interface GitHubRepositoryPage {
  readonly repositories: InstalledGitHubRepository[];
  readonly page: number;
  readonly perPage: number;
  readonly hasNextPage: boolean;
}
