import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ResilienceModule, ResilienceService } from "@nestjs/resilience";
import { GitHubRateLimitGuard, GitHubRateLimitError, type GitHubRateDiagnostic } from "../dist/github/rate-limit.js";
import { createResilientHttpTransport, isTransientDependencyError, resilienceOptions } from "../dist/reliability/resilience.js";
import type { HttpTransport } from "../dist/external-clients.js";

test("primary throttles honor reset and retry-after without retaining URLs or credentials", (context: TestContext): void => {
  let now: number = 1_800_000_000_000;
  context.mock.method(Date, "now", (): number => now);
  const diagnostics: GitHubRateDiagnostic[] = [];
  const guard: GitHubRateLimitGuard = new GitHubRateLimitGuard((event: GitHubRateDiagnostic): void => { diagnostics.push(event); });
  assert.equal(guard.observe("/user/secret-user-id", "public", new Response(null, { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-limit": "60", "x-ratelimit-reset": String(now / 1000 + 120), "retry-after": "180",
  } })), true);
  assert.throws(() => guard.check("public"), GitHubRateLimitError);
  guard.check("authenticated");
  now += 179_999;
  assert.throws(() => guard.check("public"), GitHubRateLimitError);
  now++;
  guard.check("public");
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret-user-id|authorization|token/i);
  assert.equal(diagnostics[0]?.category, "account");
  assert.equal(isTransientDependencyError(new GitHubRateLimitError(now + 60_000)), false);
});

test("secondary 429 defaults to a minute; ordinary permission denials do not impose cooldowns", (context: TestContext): void => {
  let now: number = 1_800_000_000_000;
  context.mock.method(Date, "now", (): number => now);
  const guard: GitHubRateLimitGuard = new GitHubRateLimitGuard((): void => { throw new Error("diagnostic sink unavailable"); });
  assert.equal(guard.observe("/repos/private", "authenticated", new Response(null, { status: 403 })), false);
  guard.check("authenticated");
  guard.observe("/repos/private", "authenticated", new Response(null, { status: 429, headers: { "retry-after": "invalid", "x-ratelimit-reset": "NaN" } }));
  assert.throws(() => guard.check("authenticated"), GitHubRateLimitError);
  now += 60_000;
  guard.check("authenticated");
});

test("the last successful primary request is returned, but subsequent requests wait for reset", (context: TestContext): void => {
  let now: number = 1_800_000_000_000;
  context.mock.method(Date, "now", (): number => now);
  const guard: GitHubRateLimitGuard = new GitHubRateLimitGuard((): void => {});
  assert.equal(guard.observe("/app", "authenticated", new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 10) } })), false);
  assert.throws(() => guard.check("authenticated"), GitHubRateLimitError);
  now += 10_000;
  guard.check("authenticated");
});

test("real resilience policies do not retry throttled GitHub reads or writes, while other dependencies still retry", async (context: TestContext): Promise<void> => {
  const module: INestApplicationContext = await NestFactory.createApplicationContext(ResilienceModule.forRoot(resilienceOptions(new ConfigService())), { logger: false });
  context.after(async (): Promise<void> => { await module.close(); });
  const resilience: ResilienceService = module.get(ResilienceService);
  let githubCalls: number = 0;
  let devopsCalls: number = 0;
  const transport: HttpTransport = createResilientHttpTransport(async (input: Parameters<HttpTransport>[0]): Promise<Response> => {
    if (String(input).includes("dev.azure.com")) { devopsCalls++; return new Response(null, { status: devopsCalls === 1 ? 503 : 200 }); }
    githubCalls++;
    return new Response("sensitive-upstream", { status: 429, headers: { "retry-after": "1" } });
  }, resilience, (): void => {});
  await assert.rejects(transport("https://api.github.com/user/123"), GitHubRateLimitError);
  await assert.rejects(transport("https://api.github.com/user/456"), GitHubRateLimitError);
  assert.equal(githubCalls, 1);
  await assert.rejects(transport("https://api.github.com/app/installations/1/access_tokens", { method: "POST", headers: { Authorization: "Bearer temporary" } }), GitHubRateLimitError);
  assert.equal(githubCalls, 2);
  assert.equal((await transport("https://dev.azure.com/org/read")).status, 200);
  assert.equal(devopsCalls, 2);
});
