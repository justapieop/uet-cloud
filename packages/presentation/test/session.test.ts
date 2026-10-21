import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express as ExpressApplication, type Request, type Response, type NextFunction } from "express";
import session, { type CookieOptions } from "express-session";
import { Passport } from "passport";
import { User } from "@kumo/domain";
import type { ExecutionContext } from "@nestjs/common";
import { LoggedInGuard } from "../dist/common/Auth.guard.js";
import { createSessionCookieOptions } from "../dist/common/Session.options.js";

test("HTTP login sets a cookie that authenticates the next request despite an unavailable frontend", async (context: TestContext): Promise<void> => {
  const app: ExpressApplication = express();
  const passport: InstanceType<typeof Passport> = new Passport();
  const guard: LoggedInGuard = new LoggedInGuard();
  const user: User = new User({ id: "123", displayName: "Alice", suspended: false });
  const restoredIds: string[] = [];

  passport.serializeUser((value: Express.User, done: (error: unknown, id?: string) => void): void => {
    done(null, (value as User).id);
  });
  passport.deserializeUser((id: string, done: (error: unknown, user?: User | false) => void): void => {
    restoredIds.push(id);
    done(null, id === user.id ? user : false);
  });
  app.use(session({
    secret: "session-regression-test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: createSessionCookieOptions("development"),
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.get("/auth/callback", (request: Request, response: Response, next: NextFunction): void => {
    request.logIn(user, (error: unknown): void => {
      if (error) {
        next(error);
        return;
      }
      response.redirect("http://localhost:8000/");
    });
  });
  app.get("/user/me", (request: Request, response: Response): void => {
    const executionContext: ExecutionContext = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    if (!guard.canActivate(executionContext)) {
      response.sendStatus(403);
      return;
    }
    response.json({ id: (request.user as User).id });
  });

  const server: Server = app.listen(0, "127.0.0.1");
  context.after(async (): Promise<void> => {
    await new Promise<void>((resolve, reject): void => {
      server.close((error?: Error): void => error ? reject(error) : resolve());
    });
  });
  await new Promise<void>((resolve, reject): void => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address: AddressInfo = server.address() as AddressInfo;
  const baseUrl: string = `http://127.0.0.1:${address.port}`;
  const callback: globalThis.Response = await fetch(`${baseUrl}/auth/callback`, { redirect: "manual" });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "http://localhost:8000/");
  const setCookie: string | null = callback.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.doesNotMatch(setCookie, /; Secure/i);
  const cookie: string = setCookie.split(";")[0]!;
  const authenticated: globalThis.Response = await fetch(`${baseUrl}/user/me`, { headers: { cookie } });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), { id: user.id });
  assert.deepEqual(restoredIds, [user.id]);
  const anonymous: globalThis.Response = await fetch(`${baseUrl}/user/me`);
  assert.equal(anonymous.status, 403);
});

test("production requires secure cookies while development and test allow HTTP", (): void => {
  ["production", "unknown", ""].forEach((environment: string): void => {
    const cookie: CookieOptions = createSessionCookieOptions(environment);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
  });
  ["development", "test", " DEVELOPMENT "].forEach((environment: string): void => {
    assert.equal(createSessionCookieOptions(environment).secure, false);
  });
});
