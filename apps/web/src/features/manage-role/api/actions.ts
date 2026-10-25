"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiClient } from "@/shared/api/server";
import { adminError, type AdminResult } from "@/shared/api/admin-errors";
import type { AdminRoleCreate, AdminRoleWrite } from "@/entities/role";
import { parseRole } from "../model/parse-role";

function roleError(status: number): string {
  if (status === 403) return "You cannot grant permissions you do not hold or remove your own role management access.";
  if (status === 409) return "The role conflicts with an existing role or assignment. Refresh and check the role list.";
  if (status === 404) return "The selected role no longer exists. Refresh the role list.";
  return adminError(status);
}

function validPermissionKeys(permissionKeys: readonly string[]): boolean {
  return Array.isArray(permissionKeys) && permissionKeys.length <= 100
    && permissionKeys.every((key: string): boolean => typeof key === "string" && key.length > 0 && key.length <= 255);
}

export async function saveRole(
  form: FormData,
  permissionKeys: readonly string[],
  existingId?: string,
): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  if (!validPermissionKeys(permissionKeys)) return { error: "The permission catalog could not be verified. Refresh and try again." };

  const parsed: AdminResult<AdminRoleCreate> = parseRole(form, permissionKeys, existingId);
  if (!parsed.data) return { error: parsed.error };

  const body: AdminRoleWrite = {
    name: parsed.data.name,
    active: parsed.data.active,
    permissions: parsed.data.permissions,
  };

  try {
    const result: { response: Response } = existingId
      ? await apiClient.PUT("/roles/{id}", {
          params: { path: { id: existingId } },
          headers: { cookie },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        })
      : await apiClient.POST("/roles", {
          headers: { cookie },
          body: { id: parsed.data.id, ...body },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
    if (!result.response.ok) return { error: roleError(result.response.status) };
    revalidatePath("/admin");
    return { data: existingId ? "Role updated." : "Role created." };
  } catch {
    return { error: "The role could not be confirmed. Refresh the role list before trying again." };
  }
}

export async function deactivateRole(id: string): Promise<AdminResult<string>> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: adminError(401) };
  if (typeof id !== "string" || !id.trim() || id.length > 255) return { error: "Select a valid role." };

  try {
    const result: { response: Response } = await apiClient.DELETE("/roles/{id}", {
      params: { path: { id } },
      headers: { cookie },
      cache: "no-store",
      parseAs: "text",
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok) return { error: roleError(result.response.status) };
    revalidatePath("/admin");
    return { data: "Role deactivated. Existing assignments remain but grant no access." };
  } catch {
    return { error: "Deactivation could not be confirmed. Refresh to check the role status." };
  }
}
