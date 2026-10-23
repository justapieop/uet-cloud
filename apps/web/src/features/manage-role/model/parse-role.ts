import type { AdminRoleCreate } from "@/entities/role";
import type { AdminResult } from "@/shared/api/admin-errors";

export function parseRole(
  form: FormData,
  availablePermissionKeys: readonly string[],
  existingId?: string,
): AdminResult<AdminRoleCreate> {
  const text: (key: string) => string = (key: string): string => String(form.get(key) ?? "").trim();
  const id: string = existingId ?? text("id");
  const name: string = text("name");
  if (!id || id.length > 255) return { error: "Enter a role ID of up to 255 characters." };
  if (!name || name.length > 255) return { error: "Enter a role name of up to 255 characters." };

  const permissions: string[] = form.getAll("permissions").map((value: FormDataEntryValue): string => String(value));
  if (new Set(permissions).size !== permissions.length) return { error: "Select each permission at most once." };
  const available: ReadonlySet<string> = new Set(availablePermissionKeys);
  if (permissions.some((key: string): boolean => !available.has(key))) return { error: "Select permissions from the current catalog." };

  return {
    data: {
      id,
      name,
      active: form.get("active") === "on",
      permissions,
    },
  };
}
