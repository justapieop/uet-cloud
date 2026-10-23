import type { JSX } from "react";
import type { AdminPermission, AdminRole, AdminRoleCatalog, AdminUserRoles } from "@/entities/role";
import { getRoleCatalog, getUserRoleAssignments } from "@/entities/role/server";
import { RoleAssignment } from "@/features/assign-roles";
import { RoleEditor } from "@/features/manage-role";
import type { AdminResult } from "@/shared/api/admin-errors";

const PANEL: string = "rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6";
const LINK: string = "text-sm text-blue-300 transition-colors hover:text-blue-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

function ErrorNotice({ message }: { readonly message: string }): JSX.Element {
  return <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-5 text-sm leading-6 text-red-200">{message}</div>;
}

function formatDate(value: string): string {
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function PermissionBadges({ keys, permissions }: { readonly keys: readonly string[]; readonly permissions: readonly AdminPermission[] }): JSX.Element {
  if (!keys.length) return <span className="text-xs text-muted-text">No grants</span>;
  const names: ReadonlyMap<string, string> = new Map(permissions.map((permission: AdminPermission): [string, string] => [permission.key, permission.name]));
  return <div className="flex max-w-72 flex-wrap gap-1.5">{keys.map((key: string): JSX.Element => <span key={key} className={`rounded-full border px-2 py-0.5 text-[10px] leading-5 ${key === "Super" ? "border-amber-400/25 bg-amber-400/5 text-amber-200" : "border-surface-border text-muted-text"}`}>{names.get(key) ?? key}</span>)}</div>;
}

function RolesCatalog({ catalog }: { readonly catalog: AdminRoleCatalog }): JSX.Element {
  return <section className="overflow-hidden rounded-xl border border-surface-border bg-surface/40" aria-label="All roles">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-6 py-5"><h2 className="text-sm font-medium">All roles</h2><span className="text-xs text-muted-text">{catalog.roles.length} configured, including inactive roles</span></div>
    {!catalog.roles.length ? <p className="px-6 py-12 text-sm text-muted-text">No roles are configured. Create a role to get started.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><caption className="sr-only">Role configuration and grants</caption><thead className="border-b border-surface-border text-xs text-muted-text"><tr>{["Role", "Status", "Permissions", "Created", ""].map((label: string): JSX.Element => <th key={label} scope="col" className="px-6 py-3 font-medium">{label || "Actions"}</th>)}</tr></thead><tbody className="divide-y divide-surface-border">{catalog.roles.map((role: AdminRole): JSX.Element => <tr key={role.id} className="align-top hover:bg-white/[0.02]">
      <td className="max-w-60 px-6 py-5"><p className="break-words font-medium">{role.name}</p><p className="mt-1 break-all font-mono text-xs text-muted-text">{role.id}</p></td>
      <td className="px-6 py-5"><span className={`text-xs ${role.active ? "text-emerald-300" : "text-muted-text"}`}>{role.active ? "Active" : "Inactive"}</span></td>
      <td className="px-6 py-5"><PermissionBadges keys={role.permissions} permissions={catalog.permissions} /></td>
      <td className="whitespace-nowrap px-6 py-5 text-xs text-muted-text">{formatDate(role.created_at)}</td>
      <td className="px-6 py-5"><a href={`/admin?tab=roles&edit=${encodeURIComponent(role.id)}`} className={LINK} aria-label={`Edit ${role.name}`}>Edit</a></td>
    </tr>)}</tbody></table></div>}
  </section>;
}

export async function RolesSection({ edit, userId }: { readonly edit?: string; readonly userId: string }): Promise<JSX.Element> {
  const [catalogResult, assignmentResult]: [AdminResult<AdminRoleCatalog>, AdminResult<AdminUserRoles> | null] = await Promise.all([
    getRoleCatalog(),
    userId ? getUserRoleAssignments(userId) : Promise.resolve(null),
  ]);
  if (!catalogResult.data) return <ErrorNotice message={catalogResult.error} />;

  const catalog: AdminRoleCatalog = catalogResult.data;
  const selected: AdminRole | undefined = edit ? catalog.roles.find((role: AdminRole): boolean => role.id === edit) : undefined;
  const selectedKey: string = selected ? `${selected.id}-${selected.name}-${selected.active}-${selected.permissions.join(",")}` : "create";

  return <div className="space-y-6">
    {edit && !selected && <ErrorNotice message="The selected role could not be found. Refresh the catalog and choose another role." />}
    {selected && <section className={PANEL}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-medium">Edit {selected.name}</h2><span className={`text-xs ${selected.active ? "text-emerald-300" : "text-muted-text"}`}>{selected.active ? "Active" : "Inactive"}</span></div><RoleEditor key={selectedKey} role={selected} permissions={catalog.permissions} /></section>}
    {!edit && <details className={PANEL}><summary className="cursor-pointer text-sm font-medium">Create a role</summary><div className="mt-6"><RoleEditor permissions={catalog.permissions} /></div></details>}

    <RolesCatalog catalog={catalog} />

    <section className={PANEL} aria-label="Role assignments">
      <h2 className="text-base font-medium">Assign roles</h2>
      <p className="mt-2 text-sm leading-6 text-muted-text">Look up a user by their exact Kumo user ID, then apply the exact set of active roles they should hold.</p>
      <form action="/admin" method="get" className="mt-5 flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="roles" />
        <label className="min-w-0 flex-1 text-xs font-medium">User ID<input name="user" required maxLength={255} defaultValue={userId} placeholder="Kumo user ID" className="mt-2 block h-10 w-full min-w-48 rounded-lg border border-surface-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent" /></label>
        <button type="submit" className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Find user</button>
      </form>
      {assignmentResult && (!assignmentResult.data
        ? <div className="mt-6"><ErrorNotice message={assignmentResult.error} /></div>
        : <div className="mt-6 border-t border-surface-border pt-6"><RoleAssignment key={`${assignmentResult.data.user.id}-${assignmentResult.data.roles.map((role: AdminRole): string => role.id).join("-")}`} user={assignmentResult.data.user} roles={catalog.roles} assigned={assignmentResult.data.roles} permissions={catalog.permissions} /></div>)}
    </section>
  </div>;
}
