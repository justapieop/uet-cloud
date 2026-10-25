import "server-only";

import { getUserPlan, type UserPlanResult } from "@/entities/plan/server";
import { getCurrentUser, type CurrentUser } from "./get-current-user";

export type AccountAccess =
  | { readonly kind: "signed-out" }
  | { readonly kind: "subscribed" }
  | { readonly kind: "needs-plan" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

export async function getAccountAccess(): Promise<AccountAccess> {
  const user: CurrentUser | null = await getCurrentUser();
  if (!user) return { kind: "signed-out" };

  const result: UserPlanResult = await getUserPlan();
  if (result.kind !== "success") return result;
  return { kind: result.data.has_plan ? "subscribed" : "needs-plan" };
}