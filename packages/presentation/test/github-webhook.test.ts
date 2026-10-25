import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, type TestContext } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { GitHubWebhookVerifier } from "@kumo/infrastructure";
import { GitHubWebhookController } from "../dist/controllers/GitHubWebhook.controller.js";
import { InvalidGitHubWebhook, ProcessGitHubPushCase } from "@kumo/application";
import { RouteReadCache } from "../dist/common/ReadCache.js";

async function startReceiver(
  context: TestContext, secret?: string,
  processor: Pick<ProcessGitHubPushCase, "exec"> = { exec: async (): Promise<null> => null },
  invalidate: (userId: string) => Promise<void> = async (): Promise<void> => {},
): Promise<string> {
  class WebhookTestModule {}
  Module({ controllers: [GitHubWebhookController], providers: [
    GitHubWebhookVerifier,
    { provide: ProcessGitHubPushCase, useValue: processor },
    { provide: RouteReadCache, useValue: { invalidateDeployments: invalidate } },
    { provide: ConfigService, useValue: new ConfigService({ GITHUB_WEBHOOK_SECRET: secret ?? "" }) },
  ] })(WebhookTestModule);
  const app: INestApplication = await NestFactory.create(WebhookTestModule, { rawBody: true, logger: false, abortOnError: false });
  app.enableCsrfProtection();
  app.useSecurityHeaders();
  context.after(async (): Promise<void> => { await app.close(); });
  await app.listen(0, "127.0.0.1");
  return `${await app.getUrl()}/github/webhook`;
}

test("webhook HTTP verifies original bytes, accepts only pushes and rejects other events before processing", async (context: TestContext): Promise<void> => {
  const secret: string = "webhook-test-secret";
  let calls: number = 0;
  const url: string = await startReceiver(context, secret, { exec: async (): Promise<null> => { calls++; return null; } });
  const body: string = '{ "message": "こんにちは 👋", "zen": "test" }\n';
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-GitHub-Event": "push",
    "X-GitHub-Delivery": "11111111-2222-4333-8444-555555555555",
    "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  };
  const events: string[] = ["push", "push"];
  for (let index: number = 0; index < events.length; index++) {
    const response: Response = await fetch(url, { method: "POST", headers: { ...headers, "X-GitHub-Event": events[index]! }, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { received: true });
  }
  const unsupported: string[] = ["ping", "installation", "pull_request", "future_event"];
  for (let index: number = 0; index < unsupported.length; index++) {
    const response: Response = await fetch(url, { method: "POST", headers: { ...headers, "X-GitHub-Event": unsupported[index]! }, body });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Only GitHub push webhooks are supported/);
  }
  assert.equal(calls, 2);
  assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(JSON.parse(body)) })).status, 401);
  const signatures: (string | undefined)[] = [undefined, "sha1=1234", "sha256=ab", `sha256=${"0".repeat(64)}`, `${headers["X-Hub-Signature-256"]}, invalid`];
  for (let index: number = 0; index < signatures.length; index++) {
    const invalidHeaders: Record<string, string> = { ...headers };
    if (signatures[index] === undefined) delete invalidHeaders["X-Hub-Signature-256"];
    else invalidHeaders["X-Hub-Signature-256"] = signatures[index]!;
    const response: Response = await fetch(url, { method: "POST", headers: invalidHeaders, body });
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /webhook-test-secret/);
  }
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "X-GitHub-Event": "" }, body })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "X-GitHub-Delivery": "invalid" }, body })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body })).status, 415);
  assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400);
});

test("webhook HTTP fails closed when its secret is absent", async (context: TestContext): Promise<void> => {
  const url: string = await startReceiver(context);
  const response: Response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 503);
});

test("HTTP forwards only verified payloads, invalidates the owner's cache, and returns safe failures", async (context: TestContext): Promise<void> => {
  let calls: number = 0;
  let failure: Error | undefined;
  const invalidations: string[] = [];
  const url: string = await startReceiver(context, "secret", {
    exec: async (event: string, payload: unknown): Promise<string> => {
      calls++;
      assert.equal(event, "push"); assert.deepEqual(payload, { test: true });
      if (failure) throw failure;
      return "123";
    },
  }, async (owner: string): Promise<void> => { invalidations.push(owner); });
  const body: string = '{"test":true}';
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "X-GitHub-Event": "push",
    "X-GitHub-Delivery": "11111111-2222-4333-8444-555555555555",
    "X-Hub-Signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`,
  };
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "X-Hub-Signature-256": "bad" }, body })).status, 401);
  assert.equal(calls, 0);
  assert.equal((await fetch(url, { method: "POST", headers, body })).status, 200);
  assert.deepEqual(invalidations, ["123"]);
  failure = new InvalidGitHubWebhook("Invalid GitHub push payload");
  assert.equal((await fetch(url, { method: "POST", headers, body })).status, 400);
  failure = new Error("sensitive provider failure");
  const response: Response = await fetch(url, { method: "POST", headers, body });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /sensitive provider/);
  assert.deepEqual(invalidations, ["123"]);
});
