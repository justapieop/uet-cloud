export interface GitHubRateDiagnostic {
  readonly event: "github.rate-limit.observed" | "github.rate-limit.exhausted";
  readonly category: "account" | "installation" | "token" | "app" | "repository";
  readonly scope: "public" | "authenticated";
  readonly status: number;
  readonly remaining?: number;
  readonly limit?: number;
  readonly resetAt?: number;
  readonly retryAt?: number;
}

export class GitHubRateLimitError extends Error {
  public constructor(public readonly retryAt: number) {
    super("GitHub API rate limited (HTTP 429); retry after the rate-limit cooldown");
  }
}

/** Stores timestamps only. Authenticated calls share a conservative process-local gate. */
export class GitHubRateLimitGuard {
  private readonly cooldowns: Map<"public" | "authenticated", number> = new Map<"public" | "authenticated", number>();

  public constructor(private readonly report: (event: GitHubRateDiagnostic) => void) {}

  public check(scope: "public" | "authenticated"): void {
    const retryAt: number = this.cooldowns.get(scope) ?? 0;
    if (Date.now() < retryAt) throw new GitHubRateLimitError(retryAt);
    this.cooldowns.delete(scope);
  }

  public observe(path: string, scope: "public" | "authenticated", response: Response): boolean {
    const now: number = Date.now();
    const remaining: number | undefined = integerHeader(response.headers.get("x-ratelimit-remaining"));
    const limit: number | undefined = integerHeader(response.headers.get("x-ratelimit-limit"));
    const reset: number | undefined = integerHeader(response.headers.get("x-ratelimit-reset"));
    const resetAt: number | undefined = reset !== undefined && Number.isSafeInteger(reset * 1000) ? reset * 1000 : undefined;
    const retry: string | null = response.headers.get("retry-after");
    const seconds: number | undefined = integerHeader(retry);
    const retryAfter: number = seconds !== undefined ? now + seconds * 1000 : retry ? Date.parse(retry) : NaN;
    const throttled: boolean = response.status === 429 || (response.status === 403 && (remaining === 0 || retry !== null));
    let retryAt: number | undefined;
    if (throttled || remaining === 0) {
      retryAt = Math.max(now + (throttled ? 60_000 : 1000), resetAt ?? 0,
        Number.isSafeInteger(retryAfter) ? retryAfter : 0, this.cooldowns.get(scope) ?? 0);
      this.cooldowns.set(scope, retryAt);
    }
    if (remaining !== undefined || limit !== undefined || throttled) {
      const category: GitHubRateDiagnostic["category"] = path.startsWith("/user/") ? "account"
        : path.endsWith("/access_tokens") ? "token" : path.includes("installation") ? "installation"
        : path === "/app" ? "app" : "repository";
      try {
        this.report({ event: throttled || remaining === 0 ? "github.rate-limit.exhausted" : "github.rate-limit.observed",
          category, scope, status: response.status, remaining, limit, resetAt, retryAt });
      } catch { /* Diagnostic sinks cannot change authorization or request outcomes. */ }
    }
    return throttled;
  }
}

function integerHeader(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed: number = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
