import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import session from "express-session";
import { Passport } from "passport";
import type { Request, Response as ExpressResponse } from "express";
import { User } from "@kumo/domain";
import { RootLoginCase, RootLoginDisabled, RootLoginRejected, RootLoginThrottled } from "@kumo/application";
import { RootLoginController } from "../dist/controllers/RootLogin.controller.js";

test("root HTTP login validates password-only input, rotates sessions, applies CSRF checks and sanitizes errors", async (context: TestContext): Promise<void> => {
  const root: User = new User({ id: "root", displayName: "Root", suspended: false });
  let failure: Error | null = null;
  let calls: number = 0;
  class LoginModule {}
  Module({ controllers: [RootLoginController], providers: [{ provide: RootLoginCase, useValue: {
    exec: async (password: string): Promise<User> => { calls++; if (failure) throw failure; if (password !== "correct") throw new RootLoginRejected(); return root; },
  } satisfies Pick<RootLoginCase, "exec"> }] })(LoginModule);
  const app: INestApplication = await NestFactory.create(LoginModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  const passport: InstanceType<typeof Passport> = new Passport();
  passport.serializeUser((user: Express.User, done: (error: unknown, id?: string) => void): void => done(null, (user as User).id));
  passport.deserializeUser((id: string, done: (error: unknown, user?: User | false) => void): void => done(null, id === "root" ? root : false));
  app.use(session({ secret: "root-login-http-test-only-secret", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax" } }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.enableCsrfProtection();
  app.getHttpAdapter().get("/seed", (request: Request, response: ExpressResponse): void => { (request.session as session.Session & { seeded?: boolean }).seeded = true; response.sendStatus(200); });
  app.getHttpAdapter().get("/whoami", (request: Request, response: ExpressResponse): void => { response.json({ id: (request.user as User | undefined)?.id ?? null }); });
  await app.listen(0, "127.0.0.1");
  const base: string = await app.getUrl();
  const before: Response = await fetch(`${base}/seed`);
  const oldCookie: string = before.headers.getSetCookie()[0]!.split(";")[0]!;
  const login: Response = await fetch(`${base}/auth/root/login`, { method: "POST", headers: { "Content-Type": "application/json", cookie: oldCookie }, body: JSON.stringify({ password: "correct" }) });
  assert.equal(login.status, 204);
  assert.equal(login.headers.get("cache-control"), "no-store");
  const cookie: string = login.headers.getSetCookie()[0]!.split(";")[0]!;
  assert.notEqual(cookie, oldCookie);
  assert.match(login.headers.getSetCookie()[0]!, /HttpOnly/);
  assert.deepEqual(await (await fetch(`${base}/whoami`, { headers: { cookie } })).json(), { id: "root" });
  assert.deepEqual(await (await fetch(`${base}/whoami`, { headers: { cookie: oldCookie } })).json(), { id: null });
  const bad: unknown[] = [{}, { password: 123 }, { password: "correct", username: "root" }, { password: "correct", userId: "123" }, { password: "a".repeat(1025) }];
  for (let index: number = 0; index < bad.length; index++) {
    assert.equal((await fetch(`${base}/auth/root/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad[index]) })).status, 400);
  }
  assert.equal(calls, 1);
  assert.equal((await fetch(`${base}/auth/root/login`, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ password: "correct" }) })).status, 403);
  assert.equal(calls, 1);
  const failures: readonly (readonly [Error, number])[] = [[new RootLoginDisabled(), 404], [new RootLoginRejected(), 401], [new RootLoginThrottled(), 429], [new Error("private database details"), 503]];
  for (let index: number = 0; index < failures.length; index++) {
    failure = failures[index]![0];
    const response: Response = await fetch(`${base}/auth/root/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "correct" }) });
    assert.equal(response.status, failures[index]![1]);
    assert.equal((await response.text()).includes("private database"), false);
    assert.equal(response.headers.getSetCookie().length, 0);
  }
});
