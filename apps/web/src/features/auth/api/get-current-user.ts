import "server-only";

import type { components } from "@kumo/rest";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";

export type CurrentUser = components["schemas"]["UserResponseDto"];

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader: string | null = (await headers()).get("cookie");

  if (!cookieHeader) {
    return null;
  }

  try {
    const result: { data?: CurrentUser; response: Response } = await apiClient.GET(
      "/user/me",
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );

    return result.response.ok && result.data && !result.data.suspended
      ? result.data
      : null;
  } catch {
    return null;
  }
}
