import "server-only";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminPlan, AdminPlanPage } from "./admin";

export async function getAdminPlans(page: number): Promise<AdminResult<AdminPlanPage>> {
  const cookie: string = (await headers()).get("cookie") ?? "";
  try {
    const result: { data?: AdminPlanPage; response: Response } = await apiClient.GET("/plans/all", { params: { query: { page, per_page: 20 } }, headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return result.response.ok && result.data ? { data: result.data } : { error: adminError(result.response.status) };
  } catch { return { error: adminError(503) }; }
}

export async function getAdminPlan(id: string): Promise<AdminResult<AdminPlan>> {
  const cookie: string = (await headers()).get("cookie") ?? "";
  try {
    const result: { data?: AdminPlan; response: Response } = await apiClient.GET("/plans/{id}", { params: { path: { id } }, headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return result.response.ok && result.data ? { data: result.data } : { error: adminError(result.response.status) };
  } catch { return { error: adminError(503) }; }
}
