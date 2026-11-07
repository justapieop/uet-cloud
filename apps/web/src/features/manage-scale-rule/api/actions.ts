"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import type { ScaleRuleInput, ScaleRuleResult } from "../model/types";

function outcome(response: Response): ScaleRuleResult {
  if (response.ok) return { success: true };
  const errors: Readonly<Record<number, string>> = {
    400: "Check replica limits, CPU thresholds, and durations. The scale-in threshold must be lower than scale-out.",
    403: "Your account needs deployment permissions and an active plan to enable auto scaling.",
    404: "The deployment or rule could not be found. Refresh and try again.",
    409: "The deployment is busy, a rule already exists, or these limits exceed reserved capacity or your plan. Refresh and check the limits.",
    503: "Subscription verification is unavailable. Try again shortly.",
  };
  return { success: false, error: errors[response.status] ?? "The change could not be confirmed. Refresh before retrying." };
}

export async function saveScaleRule(id: string, exists: boolean, form: FormData): Promise<ScaleRuleResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { success: false, error: "Authentication required" };
  const body: ScaleRuleInput = {
    enabled: form.get("enabled") === "on", metric: "cpu",
    scale_out_threshold: Number(form.get("scale_out_threshold")), scale_in_threshold: Number(form.get("scale_in_threshold")),
    min_replicas: Number(form.get("min_replicas")), max_replicas: Number(form.get("max_replicas")),
    evaluation_window_seconds: Number(form.get("evaluation_window_seconds")), cooldown_seconds: Number(form.get("cooldown_seconds")),
  };
  try {
    const options: { params: { path: { id: string } }; headers: { cookie: string }; body: ScaleRuleInput; cache: "no-store"; signal: AbortSignal } = {
      params: { path: { id } }, headers: { cookie }, body, cache: "no-store", signal: AbortSignal.timeout(15_000),
    };
    const result: { response: Response } = exists ? await apiClient.PATCH("/deployments/{id}/scale-rule", options) : await apiClient.POST("/deployments/{id}/scale-rule", options);
    if (result.response.ok) revalidatePath(`/dashboard/deployments/${id}`);
    return outcome(result.response);
  } catch { return { success: false, error: "The change could not be confirmed. Refresh before retrying." }; }
}

export async function setScaleRuleEnabled(id: string, enabled: boolean): Promise<ScaleRuleResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { success: false, error: "Authentication required" };
  try {
    const result: { response: Response } = await apiClient.PATCH("/deployments/{id}/scale-rule", {
      params: { path: { id } }, headers: { cookie }, body: { enabled }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (result.response.ok) revalidatePath(`/dashboard/deployments/${id}`);
    return outcome(result.response);
  } catch { return { success: false, error: "The change could not be confirmed. Refresh before retrying." }; }
}

export async function deleteScaleRule(id: string): Promise<ScaleRuleResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { success: false, error: "Authentication required" };
  try {
    const result: { response: Response } = await apiClient.DELETE("/deployments/{id}/scale-rule", {
      params: { path: { id } }, headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (result.response.ok) revalidatePath(`/dashboard/deployments/${id}`);
    return outcome(result.response);
  } catch { return { success: false, error: "The change could not be confirmed. Refresh before retrying." }; }
}
