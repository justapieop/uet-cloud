import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import type { GitHubRepositoryPage } from "@kumo/application";
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

test("installed repository HTTP listing uses only session identity, validates pagination, and exposes safe fields", async (context: TestContext): Promise<void> => {
  let authenticated: boolean = true;
  let active: boolean = true;
  let suspended: boolean = false;
  let unavailable: boolean = false;
  let empty: boolean = false;
  let userId: string = "123";
  const calls: { userId: string; page: number; perPage: number }[] = [];
  class RepositoryModule {}
  Module({ controllers: [AuthController], providers: [
    { provide: ConfigService, useValue: new ConfigService({}) },
    { provide: GitHubProvider, useValue: {
      listOwnInstalledRepositories: async (id: string, page: number, perPage: number): Promise<GitHubRepositoryPage> => {
        calls.push({ userId: id, page, perPage });
        if (unavailable) throw new Error("secret-token-upstream");
        return { repositories: empty ? [] : [{ id: 42, name: "app", fullName: "alice/app", private: true, defaultBranch: "main" }], page, perPage, hasNextPage: false };
      },
    } satisfies Pick<GitHubProvider, "listOwnInstalledRepositories"> },
  ] })(RepositoryModule);
  const app: INestApplication = await NestFactory.create(RepositoryModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ id: userId, displayName: "Alice", active, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base: string = `${await app.getUrl()}/auth/github/repositories`;
  const response: globalThis.Response = await fetch(`${base}?page=2&per_page=10`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { repositories: [{ id: 42, name: "app", full_name: "alice/app", private: true, default_branch: "main", html_url: "https://github.com/alice/app" }], page: 2, per_page: 10, has_next_page: false });
  assert.deepEqual(calls, [{ userId: "123", page: 2, perPage: 10 }]);
  const queries: string[] = ["user_id=999", "installation_id=456", "owner=bob", "page=0", "per_page=101", "page=1&page=2", "page=abc"];
  for (let index: number = 0; index < queries.length; index++) {
    assert.equal((await fetch(`${base}?${queries[index]}`)).status, 400);
  }
  authenticated = false;
  assert.equal((await fetch(base)).status, 403);
  authenticated = true;
  suspended = true;
  assert.equal((await fetch(base)).status, 403);
  suspended = false;
  active = false;
  assert.equal((await fetch(base)).status, 403);
  active = true;
  assert.equal(calls.length, 1);
  userId = "999";
  empty = true;
  const other: globalThis.Response = await fetch(base);
  assert.equal(other.status, 200);
  assert.deepEqual(await other.json(), { repositories: [], page: 1, per_page: 30, has_next_page: false });
  assert.deepEqual(calls.at(-1), { userId: "999", page: 1, perPage: 30 });
  unavailable = true;
  const failure: globalThis.Response = await fetch(base);
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /secret-token-upstream/);
});
