export const API_URL: string =
  (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000")
    .replace(/\/+$/, "");

export const AUTH_LOGIN_URL: string = "/auth/login";
