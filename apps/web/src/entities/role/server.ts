import "server-only";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminRoleCatalog, AdminUserRoles } from "./index";

export async function getRoleCatalog(): Promise<AdminResult<AdminRoleCatalog>> {
  const cookie: string = (await headers()).get("cookie") ?? "";
  try {
    const result: { data?: AdminRoleCatalog; response: Response } = await apiClient.GET("/roles", {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return result.response.ok && result.data ? { data: result.data } : { error: adminError(result.response.status) };
  } catch {
    return { error: adminError(503) };
  }
}

export async function getUserRoleAssignments(userId: string): Promise<AdminResult<AdminUserRoles>> {
  const cookie: string = (await headers()).get("cookie") ?? "";
  try {
    const result: { data?: AdminUserRoles; response: Response } = await apiClient.GET("/user/{userId}/roles", {
      params: { path: { userId } },
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return result.response.ok && result.data ? { data: result.data } : { error: adminError(result.response.status) };
  } catch {
    return { error: adminError(503) };
  }
}
