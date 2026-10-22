import "server-only";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminSubscriptionPage } from "./index";

export async function getUserSubscriptions(userId: string, cursor?: string): Promise<AdminResult<AdminSubscriptionPage>> {
  const cookie: string = (await headers()).get("cookie") ?? "";
  try {
    const result: { data?: AdminSubscriptionPage; response: Response } = await apiClient.GET("/user/{userId}/subscriptions", {
      params: { path: { userId }, query: { limit: 20, ...(cursor ? { starting_after: cursor } : {}) } }, headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    return result.response.ok && result.data ? { data: result.data } : { error: adminError(result.response.status) };
  } catch { return { error: adminError(503) }; }
}
