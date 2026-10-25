"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";

export async function setCancellation(userId: string, subscriptionId: string, cancel: boolean, key: string): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  if (!userId.trim() || userId.length > 255 || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || subscriptionId.length > 255 || typeof cancel !== "boolean" || !/^[\x21-\x7e]{1,255}$/.test(key)) return { error: "Invalid subscription request. Refresh and try again." };
  try {
    const result: { response: Response } = await apiClient.PATCH("/user/{userId}/subscriptions/{subscriptionId}", {
      params: { path: { userId, subscriptionId }, header: { "idempotency-key": key, "Idempotency-Key": key } },
      headers: { cookie }, body: { cancel_at_period_end: cancel }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!result.response.ok) return { error: adminError(result.response.status) };
    revalidatePath("/admin");
    return { data: cancel ? "Cancellation scheduled for the end of the subscription period." : "Scheduled cancellation removed." };
  } catch { return { error: "The update could not be confirmed. Retry this action to reuse the same request key." }; }
}
