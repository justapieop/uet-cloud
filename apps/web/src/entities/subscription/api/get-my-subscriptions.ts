import "server-only";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { components } from "@kumo/rest";
import { MOCK_MY_SUBSCRIPTIONS } from "./mock-subscriptions";
import type { CustomerSubscription } from "../model/types";

export type MySubscriptionsResult =
  | {
      readonly kind: "success";
      readonly source: "demo" | "api";
      readonly subscriptions: readonly CustomerSubscription[];
    }
  | { readonly kind: "unavailable" };

export async function getMySubscriptions(): Promise<MySubscriptionsResult> {
  if (process.env.NODE_ENV === "development") {
    return {
      kind: "success",
      source: "demo",
      subscriptions: MOCK_MY_SUBSCRIPTIONS,
    };
  }

  const cookie: string = (await headers()).get("cookie") ?? "";
  const subscriptions: CustomerSubscription[] = [];
  let cursor: string | undefined;
  const seen: Set<string> = new Set();
  try {
    do {
      const result: { data?: components["schemas"]["AdminSubscriptionPageDto"]; response: Response } = await apiClient.GET("/user/me/subscriptions", {
        params: { query: { limit: 100, ...(cursor ? { starting_after: cursor } : {}) } },
        headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!result.response.ok || !result.data) return { kind: "unavailable" };
      subscriptions.push(...result.data.subscriptions);
      if (!result.data.has_more) return { kind: "success", source: "api", subscriptions };
      cursor = result.data.next_cursor ?? undefined;
      if (!cursor || seen.has(cursor) || seen.size >= 100) return { kind: "unavailable" };
      seen.add(cursor);
    } while (cursor);
  } catch { return { kind: "unavailable" }; }
  return { kind: "unavailable" };
}
