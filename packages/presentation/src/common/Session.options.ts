import type { CookieOptions } from "express-session";

export function parseTrustProxyHops(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("TRUST_PROXY_HOPS must be a nonnegative safe integer");
  }
  const hops: number = Number(value.trim());
  if (!Number.isSafeInteger(hops)) {
    throw new Error("TRUST_PROXY_HOPS must be a nonnegative safe integer");
  }
  return hops;
}

export function createSessionCookieOptions(environment: string): CookieOptions {
  const devMode: boolean = ["development", "test"].includes(environment.trim().toLowerCase());

  return {
    httpOnly: true,
    secure: !devMode,
    sameSite: "lax",
    maxAge: 6048e5,
  };
}
