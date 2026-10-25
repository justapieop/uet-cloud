import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { GitHubWebhookVerifier } from "../dist/github/webhook-verifier.js";

test("webhook verification matches GitHub's published HMAC-SHA256 test vector", (): void => {
  const verifier: GitHubWebhookVerifier = new GitHubWebhookVerifier(new ConfigService({ GITHUB_WEBHOOK_SECRET: "It's a Secret to Everybody" }));
  const signature: string = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.equal(verifier.verifySignature(Buffer.from("Hello, World!"), signature), true);
  assert.equal(verifier.verifySignature(Buffer.from("Hello, World?"), signature), false);
  const invalid: (string | undefined)[] = [undefined, "", "sha1=757107ea", signature.slice(0, -1), `${signature}00`, `sha256=${"z".repeat(64)}`, `${signature}, ${signature}`, `sha256=${"0".repeat(64)}`];
  invalid.forEach((value: string | undefined): void => { assert.equal(verifier.verifySignature(Buffer.from("Hello, World!"), value), false); });
});

test("webhook verification preserves whitespace, UTF-8 bytes, and the configured secret exactly", (): void => {
  const secret: string = " secret with spaces ";
  const verifier: GitHubWebhookVerifier = new GitHubWebhookVerifier(new ConfigService({ GITHUB_WEBHOOK_SECRET: secret }));
  const payload: Buffer = Buffer.from('{ "message": "こんにちは 👋" }\n');
  const signature: string = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  assert.equal(verifier.verifySignature(payload, signature), true);
  assert.equal(verifier.verifySignature(Buffer.from(JSON.stringify(JSON.parse(payload.toString("utf8")))), signature), false);
  assert.equal(new GitHubWebhookVerifier(new ConfigService({ GITHUB_WEBHOOK_SECRET: "wrong" })).verifySignature(payload, signature), false);
  [undefined, "", "   "].forEach((missing: string | undefined): void => {
    const unconfigured: GitHubWebhookVerifier = new GitHubWebhookVerifier(new ConfigService({ GITHUB_WEBHOOK_SECRET: missing ?? "" }));
    assert.equal(unconfigured.isConfigured(), false);
    assert.equal(unconfigured.verifySignature(payload, signature), false);
  });
});
