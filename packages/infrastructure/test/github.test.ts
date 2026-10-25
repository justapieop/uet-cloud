import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ConfigService } from "@nestjs/config";
import { KmsProvider, type KeyOperationInput } from "../dist/azure/kms.js";
import { GitHubProvider } from "../dist/github/provider.js";
import type { GitHubPush } from "@kumo/application";

function createProvider(context: TestContext): GitHubProvider {
  const kms: KmsProvider = Object.create(KmsProvider.prototype) as KmsProvider;
  context.mock.method(kms, "sign", async (): Promise<string> => "signature");
  const config: ConfigService = new ConfigService({
    GITHUB_APP_CLIENT_ID: "Iv1.example",
    GITHUB_APP_PRIVATE_KEY_NAME: "github-app-key",
  });
  return new GitHubProvider(kms, config, (...args: Parameters<typeof fetch>): Promise<Response> => globalThis.fetch(...args));
}

test("webhook ownership checks the live app installation and immutable personal repository owner before rebuild", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const push: GitHubPush = { repositoryId: 789, installationId: 456, ownerId: "123", owner: "owner", name: "repo", ref: "refs/heads/main", after: "a".repeat(40) };
  const validInstallation: Record<string, unknown> = { id: 456, account: { id: 123, type: "User" }, suspended_at: null };
  const validRepository: Record<string, unknown> = { id: 789, owner: { id: 123, login: "owner", type: "User" }, name: "repo", default_branch: "main" };
  let installation: Record<string, unknown> = validInstallation;
  let repository: Record<string, unknown> = validRepository;
  let status: number = 200;
  let tokens: number = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith("/installation")) return status === 200 ? Response.json(installation) : new Response("private GitHub error", { status });
    if (url.endsWith("/access_tokens")) {
      tokens++;
      assert.equal(url, "https://api.github.com/app/installations/456/access_tokens");
      assert.deepEqual(JSON.parse(String(init.body)), { repositories: ["repo"], permissions: { contents: "read" } });
      return Response.json({ token: "scoped-token", expires_at: "2099-01-01T00:00:00Z" });
    }
    assert.equal(url, "https://api.github.com/repos/owner/repo");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer scoped-token");
    return Response.json(repository);
  });
  assert.deepEqual(await provider.inspectPushRepository(push), { defaultBranch: "main" });
  const invalidInstallations: Record<string, unknown>[] = [
    { ...validInstallation, id: 999 }, { ...validInstallation, account: { id: 999, type: "User" } },
    { ...validInstallation, account: { id: 123, type: "Organization" } }, { ...validInstallation, suspended_at: "2026-01-01" },
  ];
  for (let index: number = 0; index < invalidInstallations.length; index++) {
    installation = invalidInstallations[index]!;
    assert.equal(await provider.inspectPushRepository(push), null);
    assert.equal(tokens, 1, "No token may be minted for an unowned or suspended installation");
  }
  installation = validInstallation;
  const invalidRepositories: Record<string, unknown>[] = [
    { ...validRepository, id: 999 }, { ...validRepository, owner: { id: 999, login: "owner", type: "User" } },
    { ...validRepository, owner: { id: 123, login: "owner", type: "Organization" } },
    { ...validRepository, owner: { id: 123, login: "renamed", type: "User" } }, { ...validRepository, name: "other" },
  ];
  for (let index: number = 0; index < invalidRepositories.length; index++) {
    repository = invalidRepositories[index]!;
    assert.equal(await provider.inspectPushRepository(push), null);
  }
  status = 404;
  assert.equal(await provider.inspectPushRepository(push), null);
  status = 503;
  await assert.rejects(provider.inspectPushRepository(push), /installation lookup failed/);
});

test("installation token uses a KMS-signed JWT and repository-limited read permissions", async (context: TestContext): Promise<void> => {
  const kms: KmsProvider = Object.create(KmsProvider.prototype) as KmsProvider;
  let signingInput: string = "";
  context.mock.method(kms, "sign", async (input: KeyOperationInput): Promise<string> => {
    assert.equal(input.keyName, "github-app-key");
    signingInput = input.data;
    return "signature";
  });
  const provider: GitHubProvider = new GitHubProvider(kms, new ConfigService({
    GITHUB_APP_CLIENT_ID: "Iv1.example",
    GITHUB_APP_PRIVATE_KEY_NAME: "github-app-key",
  }), (...args: Parameters<typeof fetch>): Promise<Response> => globalThis.fetch(...args));
  const before: number = Math.floor(Date.now() / 1000);
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit): Promise<Response> => {
    requests.push(url);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const headers: Headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${signingInput}.signature`);
    if (url === "https://api.github.com/repos/owner/private-app/installation") {
      assert.equal(init.method, "GET");
      return Response.json({ id: 123 });
    }
    assert.equal(url, "https://api.github.com/app/installations/123/access_tokens");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body as string), {
      repositories: ["private-app"],
      permissions: { contents: "read" },
    });
    const parts: string[] = signingInput.split(".");
    assert.equal(parts.length, 2);
    assert.deepEqual(JSON.parse(Buffer.from(parts[0], "base64url").toString()), {
      alg: "RS256", typ: "JWT",
    });
    const payload: { iss: string; iat: number; exp: number } = JSON.parse(
      Buffer.from(parts[1], "base64url").toString(),
    );
    assert.equal(payload.iss, "Iv1.example");
    assert.ok(payload.iat >= before - 60);
    assert.ok(payload.iat <= Math.floor(Date.now() / 1000) - 60);
    assert.equal(payload.exp - payload.iat, 600);
    return Response.json({ token: "installation-token", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  });
  assert.equal(await provider.getRepositoryAccessToken("owner", "private-app"), "installation-token");
  assert.deepEqual(requests, [
    "https://api.github.com/repos/owner/private-app/installation",
    "https://api.github.com/app/installations/123/access_tokens",
  ]);
});

test("installation URL discovers the authenticated app using the existing signing credentials", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "https://api.github.com/app");
    const headers: Headers = new Headers(init.headers);
    const jwt: string = headers.get("Authorization")!.replace("Bearer ", "");
    const payload: { iss: string } = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    assert.equal(payload.iss, "Iv1.example");
    assert.ok(jwt.endsWith(".signature"));
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ slug: "kumo-platform" });
  });
  assert.equal(await provider.getInstallationUrl(), "https://github.com/apps/kumo-platform/installations/new");
});

test("installation URL rejects malformed app responses and upstream failures", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const responses: Response[] = [
    Response.json({}), Response.json({ slug: "../other" }), Response.json({ slug: "app?redirect=elsewhere" }),
    Response.json({ slug: "https://example.com" }), Response.json({ slug: 123 }),
    new Response("invalid-json"), new Response("sensitive-response", { status: 403 }),
  ];
  context.mock.method(globalThis, "fetch", async (): Promise<Response> => responses.shift()!);
  for (let index: number = 0; index < 7; index++) {
    await assert.rejects(provider.getInstallationUrl(), (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sensitive-response/);
      return true;
    });
  }
});

test("repository listing uses only the session account installation and filters foreign owners across pages", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const requests: string[] = [];
  const own: Record<string, unknown> = { id: 1, name: "private-app", full_name: "alice/private-app", private: true,
    default_branch: "main", owner: { id: 123, login: "alice", type: "User" }, secret: "must-not-return" };
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit): Promise<Response> => {
    requests.push(url);
    const headers: Headers = new Headers(init.headers);
    if (url === "https://api.github.com/user/123") {
      assert.equal(headers.has("Authorization"), false);
      return Response.json({ id: 123, login: "alice", type: "User" });
    }
    if (url === "https://api.github.com/users/alice/installation") {
      return Response.json({ id: 456, account: { id: 123, type: "User" }, suspended_at: null });
    }
    if (url === "https://api.github.com/app/installations/456/access_tokens") {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body as string), { permissions: { metadata: "read" } });
      return Response.json({ token: "owned-installation-token", expires_at: new Date(Date.now() + 60_000).toISOString() });
    }
    assert.equal(headers.get("Authorization"), "Bearer owned-installation-token");
    if (url === "https://api.github.com/installation/repositories?per_page=3&page=1") {
      return Response.json({ total_count: 4, repositories: [own,
        { ...own, id: 2, full_name: "bob/private-app", owner: { id: 999, login: "bob", type: "User" } },
        { ...own, id: 3, full_name: "org/private-app", owner: { id: 888, login: "org", type: "Organization" } },
      ] });
    }
    assert.equal(url, "https://api.github.com/installation/repositories?per_page=3&page=2");
    return Response.json({ total_count: 4, repositories: [{ ...own, id: 4, private: false, default_branch: null }] });
  });
  assert.deepEqual(await provider.listOwnInstalledRepositories("123", 1, 3), {
    repositories: [{ id: 1, name: "private-app", fullName: "alice/private-app", private: true, defaultBranch: "main" }],
    page: 1, perPage: 3, hasNextPage: true,
  });
  assert.deepEqual(await provider.listOwnInstalledRepositories("123", 2, 3), {
    repositories: [{ id: 4, name: "private-app", fullName: "alice/private-app", private: false, defaultBranch: null }],
    page: 2, perPage: 3, hasNextPage: false,
  });
  assert.equal(requests.some((url: string): boolean => url.includes("/app/installations?")), false);
});

test("foreign installations and mismatched account lookups fail before minting a repository token", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  let mismatchedProfile: boolean = false;
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    if (url === "https://api.github.com/user/123") {
      return Response.json({ id: mismatchedProfile ? 999 : 123, login: "alice", type: "User" });
    }
    assert.equal(url, "https://api.github.com/users/alice/installation");
    return Response.json({ id: 456, account: { id: 999, type: "User" } });
  });
  await assert.rejects(provider.listOwnInstalledRepositories("123", 1, 30), /outside the current account/);
  mismatchedProfile = true;
  await assert.rejects(provider.listOwnInstalledRepositories("123", 1, 30), /invalid account response/);
});

test("missing or suspended personal installations return empty without a token request; provider failures do not", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  let status: number = 404;
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    if (url.endsWith("/user/123")) return Response.json({ id: 123, login: "alice", type: "User" });
    assert.equal(url, "https://api.github.com/users/alice/installation");
    return status === 200 ? Response.json({ id: 456, account: { id: 123, type: "User" }, suspended_at: "2026-10-24" })
      : new Response("sensitive-upstream", { status });
  });
  assert.deepEqual((await provider.listOwnInstalledRepositories("123", 1, 30)).repositories, []);
  status = 200;
  assert.deepEqual((await provider.listOwnInstalledRepositories("123", 1, 30)).repositories, []);
  status = 403;
  await assert.rejects(provider.listOwnInstalledRepositories("123", 1, 30), { message: "GitHub installation lookup failed: HTTP 403" });
  status = 429;
  await assert.rejects(provider.listOwnInstalledRepositories("123", 1, 30), /HTTP 429/);
});

test("malformed repository ownership and metadata fail closed", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const valid: Record<string, unknown> = { id: 1, name: "app", full_name: "alice/app", private: true, default_branch: "main", owner: { id: 123, login: "alice", type: "User" } };
  const invalid: unknown[] = [null, { ...valid, owner: {} }, { ...valid, full_name: "bob/app" }, { ...valid, private: "true" }];
  let repository: unknown;
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    if (url.endsWith("/user/123")) return Response.json({ id: 123, login: "alice", type: "User" });
    if (url.endsWith("/users/alice/installation")) return Response.json({ id: 456, account: { id: 123, type: "User" } });
    if (url.endsWith("/access_tokens")) return Response.json({ token: "token", expires_at: new Date(Date.now() + 60_000).toISOString() });
    assert.equal(url, "https://api.github.com/installation/repositories?per_page=30&page=1");
    return Response.json({ total_count: 1, repositories: [repository] });
  });
  for (let index: number = 0; index < invalid.length; index++) {
    repository = invalid[index];
    await assert.rejects(provider.listOwnInstalledRepositories("123", 1, 30), /invalid repository/);
  }
});

test("invalid repository names never reach GitHub", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  context.mock.method(globalThis, "fetch", async (): Promise<Response> => {
    assert.fail("Unexpected GitHub request");
  });
  await assert.rejects(provider.getRepositoryAccessToken("", "repo"), /owner and name/);
  await assert.rejects(provider.getRepositoryAccessToken("owner", ""), /owner and name/);
  await assert.rejects(provider.getRepositoryAccessToken("owner/other", "repo"), /owner and name/);
  await assert.rejects(provider.getRepositoryAccessToken("owner", ".."), /owner and name/);
  await assert.rejects(provider.getRepositoryAccessToken("owner", "repo?query"), /owner and name/);
});

test("GitHub errors do not expose response bodies or credentials", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  context.mock.method(globalThis, "fetch", async (): Promise<Response> =>
    new Response("sensitive-response", { status: 403 }),
  );
  await assert.rejects(provider.getRepositoryAccessToken("owner", "repo"), {
    message: "GitHub repository installation lookup failed: HTTP 403",
  });
});

test("malformed and expired token responses are rejected", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const responses: Response[] = [
    new Response("invalid-json"),
    Response.json({ expires_at: "2099-01-01T00:00:00Z" }),
    Response.json({ token: "token", expires_at: "invalid-date" }),
    Response.json({ token: "token", expires_at: "2000-01-01T00:00:00Z" }),
  ];
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    if (url.endsWith("/installation")) {
      return Response.json({ id: 123 });
    }
    const response: Response | undefined = responses.shift();
    assert.ok(response);
    return response;
  });
  for (let index: number = 0; index < 4; index++) {
    await assert.rejects(provider.getRepositoryAccessToken("owner", "repo"), /invalid installation token response/);
  }
});

test("invalid installation responses stop before requesting a token", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  const responses: Response[] = [
    new Response("invalid-json"),
    Response.json({}),
    Response.json({ id: "123" }),
    Response.json({ id: 0 }),
  ];
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> => {
    assert.ok(url.endsWith("/installation"));
    const response: Response | undefined = responses.shift();
    assert.ok(response);
    return response;
  });
  for (let index: number = 0; index < 4; index++) {
    await assert.rejects(provider.getRepositoryAccessToken("owner", "repo"), /invalid repository installation response/);
  }
});

test("token endpoint failure is reported after successful installation lookup", async (context: TestContext): Promise<void> => {
  const provider: GitHubProvider = createProvider(context);
  context.mock.method(globalThis, "fetch", async (url: string): Promise<Response> =>
    url.endsWith("/installation")
      ? Response.json({ id: 123 })
      : new Response("sensitive-response", { status: 403 }),
  );
  await assert.rejects(provider.getRepositoryAccessToken("owner", "repo"), {
    message: "GitHub installation token request failed: HTTP 403",
  });
});
