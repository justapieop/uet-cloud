"use server";

import type { components } from "@kumo/rest";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";

export type CheckoutResult =
  | { readonly checkoutUrl: string; readonly error?: never }
  | { readonly error: string; readonly checkoutUrl?: never };

function publicApiMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) return null;
  const message: unknown = error.message;
  if (typeof message === "string") return message.trim().slice(0, 400) || null;
  if (Array.isArray(message) && message.every((item: unknown): boolean => typeof item === "string")) {
    return message.join(" ").trim().slice(0, 400) || null;
  }
  return null;
}

export async function createCheckout(planId: string, idempotencyKey: string): Promise<CheckoutResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: "Sign in again to select a plan." };
  if (!planId || planId.length > 255 || !/^[\x21-\x7e][\x20-\x7e]{0,254}$/.test(idempotencyKey)) {
    return { error: "This checkout request is invalid. Refresh the page and try again." };
  }

  try {
    const result: { data?: components["schemas"]["PlanSubscriptionResponseDto"]; error?: unknown; response: Response } =
      await apiClient.POST("/plans/{id}/subscriptions", {
        params: {
          path: { id: planId },
          // The generated contract lists both casings; the SDK normalizes them to one HTTP header.
          header: { "idempotency-key": idempotencyKey, "Idempotency-Key": idempotencyKey },
        },
        headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });

    if (!result.response.ok) {
      const status: number = result.response.status;
      const expected: boolean = [400, 403, 404, 409, 503].includes(status);
      const message: string | null = expected ? publicApiMessage(result.error) : null;
      console.warn("Checkout API rejected the request", { status, planId, message });

      if (message) return { error: message };
      if (status === 400) return { error: "The checkout request was rejected. Refresh the page and try again." };
      if (status === 403) return { error: "Your account cannot start checkout. Try signing in again." };
      if (status === 404) return { error: "This plan is no longer available. Refresh to see the latest plans." };
      if (status === 409) return { error: "This checkout request conflicts with an earlier attempt. Please try again." };
      if (status === 503) return { error: "The billing service could not prepare checkout. Please try again later." };
      return { error: "Checkout could not be prepared. Please try again later." };
    }

    if (!result.data || typeof result.data.checkout_url !== "string") {
      console.warn("Checkout API returned no checkout URL", { status: result.response.status, planId });
      return { error: "The billing service did not return a checkout address. Please try again." };
    }

    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(result.data.checkout_url);
    } catch {
      return { error: "The checkout address could not be verified. Please try again." };
    }
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com" || checkoutUrl.username || checkoutUrl.password) {
      return { error: "The checkout address could not be verified. Please try again." };
    }
    return { checkoutUrl: checkoutUrl.href };
  } catch (error: unknown) {
    console.warn("Checkout API request failed before receiving a usable response", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: "Checkout could not be reached. Please try again." };
  }
}