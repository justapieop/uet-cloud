import "server-only";
import { MOCK_MY_SUBSCRIPTIONS } from "./mock-subscriptions";
import type { CustomerSubscription } from "../model/types";

export type MySubscriptionsResult =
  | {
      readonly kind: "success";
      readonly source: "demo";
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

  return { kind: "unavailable" };
}
