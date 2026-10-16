export const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const AUTH_LOGIN_URL: string = `${API_URL}/auth/login`;
