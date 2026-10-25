export interface GitHubPush {
  readonly repositoryId: number;
  readonly ownerId: string;
  readonly owner: string;
  readonly name: string;
  readonly installationId: number;
  readonly ref: string;
  readonly after: string;
}

export interface GitHubWebhookRepositoryGateway {
  /** Returns null unless the current repository and app installation belong to this personal account. */
  inspectPushRepository(push: GitHubPush): Promise<{ readonly defaultBranch: string } | null>;
}

export class InvalidGitHubWebhook extends Error {}
