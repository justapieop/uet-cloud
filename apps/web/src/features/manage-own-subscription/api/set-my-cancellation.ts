"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import { adminError } from "@/shared/api/admin-errors";

type SetMyCancellationResult =
  | { readonly kind: "demo-success"; readonly message: string }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const DEMO_SUBSCRIPTION_ID_PATTERN: RegExp = /^sub_demo_[a-z0-9_]{1,240}$/;

export async function setMyCancellation(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
  key: string,
): Promise<SetMyCancellationResult> {
  if (process.env.NODE_ENV !== "development") {
    if (typeof subscriptionId !== "string" || !/^sub_[A-Za-z0-9]{1,251}$/.test(subscriptionId) || typeof cancelAtPeriodEnd !== "boolean" || typeof key !== "string" || !/^[\x21-\x7e]{1,255}$/.test(key)) {
      return { kind: "error", message: "Invalid subscription request. Refresh and try again." };
    }
    const cookie: string = (await headers()).get("cookie") ?? "";
    try {
      const result: { response: Response } = await apiClient.PATCH("/user/me/subscriptions/{subscriptionId}", {
        params: { path: { subscriptionId }, header: { "idempotency-key": key, "Idempotency-Key": key } },
        headers: { cookie }, body: { cancel_at_period_end: cancelAtPeriodEnd }, signal: AbortSignal.timeout(20_000),
      });
      if (!result.response.ok) return { kind: "error", message: adminError(result.response.status) };
      revalidatePath("/account/billing");
      return { kind: "success", message: cancelAtPeriodEnd ? "Cancellation scheduled for the end of the period." : "Scheduled cancellation removed." };
    } catch { return { kind: "error", message: "Could not verify the update. Retry to check the result." }; }
  }

  if (
    typeof subscriptionId !== "string" ||
    !DEMO_SUBSCRIPTION_ID_PATTERN.test(subscriptionId) ||
    typeof cancelAtPeriodEnd !== "boolean"
  ) {
    return {
      kind: "error",
      message: "Invalid demo subscription request. Refresh the page and try again.",
    };
  }

  const message: string = cancelAtPeriodEnd
    ? "Demo only: cancellation would be scheduled for the end of the period. No backend or Stripe change was made."
    : "Demo only: the scheduled cancellation would be removed. No backend or Stripe change was made.";

  return { kind: "demo-success", message };
}
