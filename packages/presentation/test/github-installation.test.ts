import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { User } from "@kumo/domain";
import { GitHubProvider } from "@kumo/infrastructure";
import type { NextFunction, Request, Response } from "express";
import { AuthController } from "../dist/controllers/Auth.controller.js";

test("GitHub installation redirect resolves the configured app and requires an eligible session", async (context: TestContext): Promise<void> => {
  let unavailable: boolean = false;
  let lookups: number = 0;
  let authenticated: boolean = true;
  let active: boolean = true;
  let suspended: boolean = false;
  class InstallationModule {}
  Module({
    controllers: [AuthController],
    providers: [
      { provide: ConfigService, useValue: new ConfigService({}) },
      { provide: GitHubProvider, useValue: {
        getInstallationUrl: async (): Promise<string> => {
          lookups++;
          if (unavailable) throw new Error("sensitive upstream failure");
          return "https://github.com/apps/kumo-platform/installations/new";
        },
      } satisfies Pick<GitHubProvider, "getInstallationUrl"> },
    ],
  })(InstallationModule);
  const app: INestApplication = await NestFactory.create(InstallationModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ id: "123", displayName: "Alice", active, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const redirect: globalThis.Response = await fetch(`${base}/auth/github/install?redirect_url=https://example.com`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://github.com/apps/kumo-platform/installations/new");
  assert.equal(redirect.headers.get("cache-control"), "private, no-store");

  authenticated = false;
  assert.equal((await fetch(`${base}/auth/github/install`, { redirect: "manual" })).status, 403);
  authenticated = true;
  suspended = true;
  assert.equal((await fetch(`${base}/auth/github/install`, { redirect: "manual" })).status, 403);
  suspended = false;
  active = false;
  assert.equal((await fetch(`${base}/auth/github/install`, { redirect: "manual" })).status, 403);
  active = true;
  assert.equal(lookups, 1);

  unavailable = true;
  const response: globalThis.Response = await fetch(`${base}/auth/github/install`, { redirect: "manual" });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("location"), null);
  assert.doesNotMatch(await response.text(), /sensitive upstream/);
});
