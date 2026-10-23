"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminUserRoleWrite } from "@/entities/role";

function assignmentError(status: number): string {
  if (status === 403) return "You cannot grant permissions you do not hold or remove your own role management access.";
  if (status === 404) return "The user or one of the selected roles no longer exists. Refresh and try again.";
  if (status === 409) return "One or more selected roles are inactive or conflict with the current assignments.";
  return adminError(status);
}

export async function saveUserRoles(userId: string, roleIds: readonly string[]): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  if (typeof userId !== "string" || !userId.trim() || userId.length > 255) return { error: "Enter a valid Kumo user ID." };
  if (!Array.isArray(roleIds) || roleIds.length > 100 || !roleIds.every((id: string): boolean => typeof id === "string" && id.length > 0 && id.length <= 255)) {
    return { error: "Select valid roles." };
  }
  if (new Set(roleIds).size !== roleIds.length) return { error: "Select each role at most once." };

  const body: AdminUserRoleWrite = { role_ids: [...roleIds] };
  try {
    const result: { response: Response } = await apiClient.PUT("/user/{userId}/roles", {
      params: { path: { userId } },
      headers: { cookie },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok) return { error: assignmentError(result.response.status) };
    revalidatePath("/admin");
    return { data: "Role assignments updated." };
  } catch {
    return { error: "The assignment could not be confirmed. Refresh the user before trying again." };
  }
}
