"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminPlanWrite } from "@/entities/plan/admin";
import { parsePlan } from "../model/parse-plan";

export async function savePlan(form: FormData, existingId?: string): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  const id: string = existingId ?? String(form.get("id") ?? "").trim();
  if (!id.trim() || id.length > 255) return { error: "Enter a plan ID of up to 255 characters." };
  const parsed: AdminResult<AdminPlanWrite> = parsePlan(form);
  if (!parsed.data) return { error: parsed.error };
  try {
    const result: { response: Response } = existingId
      ? await apiClient.PUT("/plans/{id}", { params: { path: { id } }, headers: { cookie }, body: parsed.data, cache: "no-store", signal: AbortSignal.timeout(15_000) })
      : await apiClient.POST("/plans", { headers: { cookie }, body: { id, ...parsed.data }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!result.response.ok) return { error: adminError(result.response.status) };
    revalidatePath("/admin"); revalidatePath("/plans");
    return { data: existingId ? "Plan updated." : "Plan created." };
  } catch { return { error: "The save could not be confirmed. Refresh the plan list before trying again." }; }
}

export async function deactivatePlan(id: string): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  if (!id || id.length > 255) return { error: "Select a valid plan." };
  try {
    const result: { response: Response } = await apiClient.DELETE("/plans/{id}", { params: { path: { id } }, headers: { cookie }, cache: "no-store", parseAs: "text", signal: AbortSignal.timeout(15_000) });
    if (!result.response.ok) return { error: adminError(result.response.status) };
    revalidatePath("/admin"); revalidatePath("/plans");
    return { data: "Plan deactivated. Existing Stripe subscriptions were not canceled." };
  } catch { return { error: "Deactivation could not be confirmed. Refresh to check the plan status." }; }
}
