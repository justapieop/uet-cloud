"use client";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction } from "react";
import type { AdminPermission, AdminRole } from "@/entities/role";
import type { AdminResult } from "@/shared/api/admin-errors";
import { deactivateRole, saveRole } from "../api/actions";

const FIELD: string = "mt-2 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent";

function permissionNames(keys: readonly string[], permissions: readonly AdminPermission[]): string {
  const names: ReadonlyMap<string, string> = new Map(permissions.map((permission: AdminPermission): [string, string] => [permission.key, permission.name]));
  return keys.map((key: string): string => names.get(key) ?? key).join(", ");
}

export function RoleEditor({ role, permissions }: { readonly role?: AdminRole; readonly permissions: readonly AdminPermission[] }): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [result, setResult]: [AdminResult<string> | null, Dispatch<SetStateAction<AdminResult<string> | null>>] = useState<AdminResult<string> | null>(null);
  const [confirm, setConfirm]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const busy: RefObject<boolean> = useRef(false);
  const permissionKeys: readonly string[] = permissions.map((permission: AdminPermission): string => permission.key);

  async function run(task: () => Promise<AdminResult<string>>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    try {
      const response: AdminResult<string> = await task();
      setResult(response);
      if (response.data) {
        setConfirm(false);
        router.refresh();
      }
    } catch {
      setResult({ error: "The request could not be confirmed. Refresh the role list before retrying." });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form
      aria-label={role ? "Edit role" : "Create role"}
      aria-busy={pending}
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const form: FormData = new FormData(event.currentTarget);
        void run((): Promise<AdminResult<string>> => saveRole(form, permissionKeys, role?.id));
      }}
      className="space-y-6"
    >
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        <label className="text-xs font-medium">Role ID<input name="id" required maxLength={255} readOnly={Boolean(role)} defaultValue={role?.id} placeholder="support" className={FIELD} /></label>
        <label className="text-xs font-medium">Name<input name="name" required maxLength={255} defaultValue={role?.name} placeholder="Support team" className={FIELD} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="active" type="checkbox" defaultChecked={role?.active ?? true} className="size-4 accent-accent" />Active role</label>
      </fieldset>

      <fieldset disabled={pending} className="space-y-3">
        <legend className="text-xs font-medium">Permissions</legend>
        <p className="text-xs leading-5 text-muted-text">Select the exact grants stored on this role. Prerequisites are guidance only; selecting a permission does not automatically select other permissions.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {permissions.map((permission: AdminPermission): JSX.Element => (
            <label key={permission.key} className={`flex gap-3 rounded-lg border p-4 transition-colors ${permission.key === "Super" ? "border-amber-400/25 bg-amber-400/5" : "border-surface-border bg-background/40 hover:border-white/15"}`}>
              <input name="permissions" type="checkbox" value={permission.key} defaultChecked={role?.permissions.includes(permission.key) ?? false} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-sm font-medium">{permission.name}</span><span className="font-mono text-[10px] text-muted-text">{permission.key}</span></span>
                <span className="mt-1 block text-xs leading-5 text-muted-text">{permission.description}</span>
                {permission.requires.length > 0 && <span className="mt-1 block text-xs leading-5 text-amber-200/80">Pairs with {permissionNames(permission.requires, permissions)}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs leading-5 text-muted-text">Role changes take effect on the next request. Deactivating a role keeps existing assignments but immediately removes its grants and prevents new assignments.</p>
      {result && <p role={result.error ? "alert" : "status"} className={`rounded-lg border border-surface-border p-3 text-sm ${result.error ? "text-red-300" : "text-emerald-300"}`}>{result.error ?? result.data}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isDisabled={pending} isPending={pending} className="rounded-lg">{pending ? "Saving…" : role ? "Save changes" : "Create role"}</Button>
        {role && <a href="/admin?tab=roles" className="px-2 text-sm text-muted-text hover:text-foreground">Close editor</a>}
        {role?.active && <Button type="button" variant="danger-soft" isDisabled={pending} className="rounded-lg sm:ml-auto" onPress={(): void => setConfirm(true)}>Deactivate role</Button>}
      </div>

      {confirm && role && <div className="space-y-3 rounded-lg border border-red-400/20 bg-red-400/5 p-4"><p className="text-sm leading-6">Deactivate {role.name}? Existing assignments remain, but this role will grant no permissions and cannot be assigned to anyone until it is made active again.</p><div className="flex flex-wrap gap-3"><Button type="button" variant="danger" isDisabled={pending} onPress={(): void => { void run((): Promise<AdminResult<string>> => deactivateRole(role.id)); }}>Confirm deactivation</Button><Button type="button" variant="ghost" isDisabled={pending} onPress={(): void => setConfirm(false)}>Keep active</Button></div></div>}
    </form>
  );
}
