import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ConfigService } from "@nestjs/config";
import { KmsProvider, type KeyOperationInput } from "../dist/azure/kms.js";
import { GitHubProvider } from "../dist/github/provider.js";

function createProvider(context: TestContext): GitHubProvider {
  const kms: KmsProvider = Object.create(KmsProvider.prototype) as KmsProvider;
  context.mock.method(kms, "sign", async (): Promise<string> => "signature");
  const config: ConfigService = new ConfigService({
    GITHUB_APP_CLIENT_ID: "Iv1.example",
    GITHUB_APP_PRIVATE_KEY_NAME: "github-app-key",
  });
  return new GitHubProvider(kms, config);
}

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
  }));
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
