import type { CookieOptions } from "express-session";

export function createSessionCookieOptions(environment: string): CookieOptions {
  const devMode: boolean = ["development", "test"].includes(environment.trim().toLowerCase());

  return {
    httpOnly: true,
    secure: !devMode,
    sameSite: "lax",
    maxAge: 6048e5,
  };
}
