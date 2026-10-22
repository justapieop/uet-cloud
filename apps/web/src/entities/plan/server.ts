import "server-only";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { Plan, UserPlans } from "./model/types";

export type UserPlanResult =
  | { readonly kind: "success"; readonly data: UserPlans }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

export async function getUserPlan(): Promise<UserPlanResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { kind: "forbidden" };

  try {
    const result: { data?: UserPlans; response: Response } = await apiClient.GET("/plans/me", {
      headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (result.response.status === 401 || result.response.status === 403) return { kind: "forbidden" };
    if (!result.response.ok || !result.data || typeof result.data.has_plan !== "boolean") return { kind: "unavailable" };
    return { kind: "success", data: result.data };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getPlans(): Promise<Plan[] | null> {
  try {
    const result: { data?: Plan[]; response: Response } = await apiClient.GET("/plans", {
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    return result.response.ok && Array.isArray(result.data) ? result.data : null;
  } catch {
    return null;
  }
}