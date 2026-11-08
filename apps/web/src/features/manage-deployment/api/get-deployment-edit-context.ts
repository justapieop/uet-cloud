"use server";

import { getUserPlan, type UserPlanResult } from "@/entities/plan/server";
import type { DeploymentEditContext } from "../model/deployment-spec";

export async function getDeploymentEditContext(): Promise<DeploymentEditContext> {
  try {
    const result: UserPlanResult = await getUserPlan();
    if (result.kind === "forbidden") return { kind: "forbidden" };
    if (result.kind === "unavailable") return { kind: "unavailable" };
    if (!result.data.has_plan || result.data.plans.length === 0) return { kind: "no-plan" };
    return { kind: "ready", plans: result.data.plans };
  } catch {
    return { kind: "unavailable" };
  }
}
