import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";
import { RootLoginThrottled } from "@kumo/application";
import { RootPasswordAuthentication } from "../dist/auth/root-password.js";

test("root password uses environment secret, rejects mismatches, and shares the database attempt gate", async (): Promise<void> => {
  let attempts: number = 0;
  let unavailable: boolean = false;
  const source: Pick<DataSource, "query"> = { query: async (): Promise<unknown> => {
    if (unavailable) throw new Error("Database unavailable");
    attempts++;
    return attempts <= 5 ? [{ attempts }] : [];
  } } as Pick<DataSource, "query">;
  const authentication: RootPasswordAuthentication = await RootPasswordAuthentication.create(
    new ConfigService({ ROOT_PASSWORD: "test-only-strong-root-password" }), source);
  assert.equal(authentication.enabled, true);
  assert.equal(await authentication.verify("test-only-strong-root-password"), true);
  assert.equal(await authentication.verify("wrong"), false);
  assert.equal(await authentication.verify("test-only-strong-root-password "), false);
  assert.equal(await authentication.verify("test-only-strong-root-password"), true);
  assert.equal(await authentication.verify("wrong"), false);
  await assert.rejects(authentication.verify("test-only-strong-root-password"), RootLoginThrottled);
  unavailable = true;
  await assert.rejects(authentication.verify("anything"), /Database unavailable/);
});

test("missing root password disables login; weak configuration fails without echoing secrets", async (): Promise<void> => {
  const source: Pick<DataSource, "query"> = { query: async (): Promise<never> => { throw new Error("Unexpected database access"); } };
  const authentication: RootPasswordAuthentication = await RootPasswordAuthentication.create(new ConfigService(), source);
  assert.equal(authentication.enabled, false);
  assert.equal(await authentication.verify("anything"), false);
  const invalid: string[] = ["short", " ".repeat(16), "a".repeat(1025)];
  for (let index: number = 0; index < invalid.length; index++) {
    await assert.rejects(RootPasswordAuthentication.create(new ConfigService({ ROOT_PASSWORD: invalid[index] }), source), /^Error: ROOT_PASSWORD must contain/);
  }
});
