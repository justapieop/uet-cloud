"use client";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction } from "react";
import type { AdminPermission, AdminRole, AdminUserRoles } from "@/entities/role";
import type { AdminResult } from "@/shared/api/admin-errors";
import { saveUserRoles } from "../api/actions";

interface RoleAssignmentProps {
  readonly user: AdminUserRoles["user"];
  readonly roles: readonly AdminRole[];
  readonly assigned: readonly AdminRole[];
  readonly permissions: readonly AdminPermission[];
}

export function RoleAssignment({ user, roles, assigned, permissions }: RoleAssignmentProps): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [result, setResult]: [AdminResult<string> | null, Dispatch<SetStateAction<AdminResult<string> | null>>] = useState<AdminResult<string> | null>(null);
  const busy: RefObject<boolean> = useRef(false);
  const assignedIds: ReadonlySet<string> = new Set(assigned.map((role: AdminRole): string => role.id));
  const activeRoles: readonly AdminRole[] = roles.filter((role: AdminRole): boolean => role.active);
  const inactiveAssigned: readonly AdminRole[] = assigned.filter((role: AdminRole): boolean => !role.active);
  const permissionNames: ReadonlyMap<string, string> = new Map(permissions.map((permission: AdminPermission): [string, string] => [permission.key, permission.name]));
  const roleGrants: (role: AdminRole) => string = (role: AdminRole): string => role.permissions.length ? role.permissions.map((key: string): string => permissionNames.get(key) ?? key).join(", ") : "No grants";

  async function run(roleIds: readonly string[]): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    try {
      const response: AdminResult<string> = await saveUserRoles(user.id, roleIds);
      setResult(response);
      if (response.data) router.refresh();
    } catch {
      setResult({ error: "The assignment could not be confirmed. Refresh the user before retrying." });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form
      aria-label={`Role assignments for ${user.display_name}`}
      aria-busy={pending}
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const form: FormData = new FormData(event.currentTarget);
        const roleIds: string[] = form.getAll("role_ids").map((value: FormDataEntryValue): string => String(value));
        void run(roleIds);
      }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-border pb-4">
        <div className="min-w-0">
          <h3 className="break-words text-base font-medium">{user.display_name}</h3>
          <p className="mt-1 break-all font-mono text-xs text-muted-text">{user.id}</p>
        </div>
        <span className={`text-xs ${user.suspended ? "text-amber-300" : "text-emerald-300"}`}>{user.suspended ? "Suspended" : "Not suspended"}</span>
      </div>

      <div className="space-y-3">
        <div><h4 className="text-xs font-medium">Assigned roles</h4><p className="mt-1 text-xs leading-5 text-muted-text">Saving applies this exact set. Unchecked roles are revoked; an empty set removes every assignment.</p></div>
        {!activeRoles.length ? <p className="rounded-lg border border-surface-border p-4 text-sm text-muted-text">No active roles are available. Save to remove all assignments.</p> : <div className="grid gap-2 sm:grid-cols-2">{activeRoles.map((role: AdminRole): JSX.Element => (
          <label key={role.id} className="flex items-start gap-3 rounded-lg border border-surface-border bg-background/40 p-3 hover:border-white/15">
            <input name="role_ids" type="checkbox" value={role.id} defaultChecked={assignedIds.has(role.id)} className="mt-0.5 size-4 shrink-0 accent-accent" />
            <span className="min-w-0"><span className="block break-words text-sm font-medium">{role.name}</span><span className="mt-0.5 block break-all font-mono text-[10px] text-muted-text">{role.id}</span><span className="mt-1 block text-xs leading-5 text-muted-text">{roleGrants(role)}</span></span>
          </label>
        ))}</div>}
        {inactiveAssigned.length > 0 && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200/90">Inactive assignments ({inactiveAssigned.map((role: AdminRole): string => role.name).join(", ")}) grant no access and will be removed when you save.</p>}
      </div>

      {result && <p role={result.error ? "alert" : "status"} className={`rounded-lg border border-surface-border p-3 text-sm ${result.error ? "text-red-300" : "text-emerald-300"}`}>{result.error ?? result.data}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isDisabled={pending} isPending={pending} className="rounded-lg">{pending ? "Saving…" : "Save role assignments"}</Button>
        <button type="reset" onClick={(): void => setResult(null)} className="px-2 text-sm text-muted-text hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Reset changes</button>
      </div>
    </form>
  );
}
