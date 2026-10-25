import type { JSX } from "react";
import type { AdminPlan, AdminPlanPage } from "@/entities/plan/admin";
import { getAdminPlans, getAdminPlan } from "@/entities/plan/admin-server";
import type { AdminSubscription, AdminSubscriptionPage } from "@/entities/subscription";
import { getUserSubscriptions } from "@/entities/subscription/server";
import { PlanEditor } from "@/features/manage-plan";
import { CancellationControl } from "@/features/manage-subscription";
import type { AdminResult } from "@/shared/api/admin-errors";
import { Navbar } from "@/widgets/navbar";
import { RolesSection } from "./roles-section";

const PANEL: string = "rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6";
const LINK: string = "text-sm text-blue-300 transition-colors hover:text-blue-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const SECTIONS: readonly (readonly [string, string, string])[] = [
  ["plans", "Plans", "/admin"],
  ["subscriptions", "Subscriptions", "/admin?tab=subscriptions"],
  ["roles", "Roles", "/admin?tab=roles"],
];

function ErrorNotice({ message }: { readonly message: string }): JSX.Element {
  return <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-5 text-sm leading-6 text-red-200">{message}</div>;
}

async function PlansSection({ page, edit }: { readonly page: number; readonly edit?: string }): Promise<JSX.Element> {
  const [result, selected]: [AdminResult<AdminPlanPage>, AdminResult<AdminPlan> | null] = await Promise.all([getAdminPlans(page), edit ? getAdminPlan(edit) : Promise.resolve(null)]);
  if (!result.data) return <ErrorNotice message={result.error} />;
  return <div className="space-y-6">
    {selected && (selected.data ? <section className={PANEL}><h2 className="mb-5 text-base font-medium">Edit {selected.data.name}</h2><PlanEditor key={JSON.stringify(selected.data)} plan={selected.data} /></section> : <ErrorNotice message={selected.error} />)}
    {!edit && <details className={PANEL}><summary className="cursor-pointer text-sm font-medium">Create a plan</summary><div className="mt-6"><PlanEditor /></div></details>}
    <section className="overflow-hidden rounded-xl border border-surface-border bg-surface/40" aria-label="All plans">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-6 py-5"><h2 className="text-sm font-medium">All plans</h2><span className="text-xs text-muted-text">Including inactive and unmapped plans</span></div>
      {!result.data.plans.length ? <p className="px-6 py-12 text-sm text-muted-text">No plans on this page. Create a plan to get started.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><caption className="sr-only">Plan configuration and availability</caption><thead className="border-b border-surface-border text-xs text-muted-text"><tr>{["Plan", "Status", "Resources", "Quotas", "Stripe product", ""].map((label: string): JSX.Element => <th key={label} scope="col" className="px-6 py-3 font-medium">{label || "Actions"}</th>)}</tr></thead><tbody className="divide-y divide-surface-border">{result.data.plans.map((plan: AdminPlan): JSX.Element => <tr key={plan.id} className="align-top hover:bg-white/[0.02]">
        <td className="max-w-60 px-6 py-5"><p className="break-words font-medium">{plan.name}</p><p className="mt-1 break-all font-mono text-xs text-muted-text">{plan.id}</p><p className="mt-2 text-xs text-muted-text">Catalog price: {plan.price}</p></td>
        <td className="px-6 py-5"><span className={`text-xs ${plan.active ? "text-emerald-300" : "text-muted-text"}`}>{plan.active ? "Active" : "Inactive"}</span></td>
        <td className="whitespace-nowrap px-6 py-5 text-xs text-muted-text">{plan.vcpu} vCPU / {plan.memory} GiB</td>
        <td className="px-6 py-5 text-xs leading-6 text-muted-text"><p>{plan.deployments} deployments</p><p>{plan.max_replicas} replicas each</p><p>{plan.disk} storage quota</p></td>
        <td className="max-w-56 break-all px-6 py-5 font-mono text-xs text-muted-text">{plan.stripe_product_id ?? "Not linked"}</td>
        <td className="px-6 py-5"><a href={`/admin?page=${page}&edit=${encodeURIComponent(plan.id)}`} className={LINK} aria-label={`Edit ${plan.name}`}>Edit</a></td>
      </tr>)}</tbody></table></div>}
      <nav aria-label="Plan pages" className="flex items-center justify-between border-t border-surface-border px-6 py-4"><div>{page > 1 && <a href={`/admin?page=${page - 1}`} className={LINK}>Previous</a>}</div><span className="text-xs text-muted-text">Page {page}</span><div>{result.data.has_next_page && page < 1_000_000 && <a href={`/admin?page=${page + 1}`} className={LINK}>Next</a>}</div></nav>
    </section>
  </div>;
}

function cancelDate(value: number | null): string {
  if (value === null) return "At period end";
  const date: Date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "At period end" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

async function SubscriptionsSection({ userId, cursor }: { readonly userId: string; readonly cursor?: string }): Promise<JSX.Element> {
  const result: AdminResult<AdminSubscriptionPage> | null = userId ? await getUserSubscriptions(userId, cursor) : null;
  return <div className="space-y-6">
    <section className={PANEL}><h2 className="text-base font-medium">User subscriptions</h2><p className="mt-2 text-sm leading-6 text-muted-text">Look up subscriptions by the user&apos;s Kumo account ID.</p>
      <form action="/admin" method="get" className="mt-5 flex flex-wrap items-end gap-3"><input type="hidden" name="tab" value="subscriptions" /><label className="min-w-0 flex-1 text-xs font-medium">User ID<input name="user" required maxLength={255} defaultValue={userId} placeholder="Kumo user ID" className="mt-2 block h-10 w-full min-w-48 rounded-lg border border-surface-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent" /></label><button type="submit" className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Find subscriptions</button></form>
    </section>
    {result && (!result.data ? <ErrorNotice message={result.error} /> : <section className="space-y-4" aria-label="Subscriptions">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="break-all text-sm text-muted-text">Subscriptions for <span className="font-mono text-foreground">{userId}</span></p><a className={LINK} href={`/admin?tab=subscriptions&user=${encodeURIComponent(userId)}`}>Refresh</a></div>
      {!result.data.subscriptions.length && <p className={PANEL + " text-sm text-muted-text"}>No subscriptions found for this user.</p>}
      {result.data.subscriptions.map((subscription: AdminSubscription): JSX.Element => <article key={subscription.id} className={PANEL}>
        <div className="flex flex-wrap justify-between gap-3"><h3 className="break-all font-mono text-sm">{subscription.id}</h3><span className="text-xs text-muted-text">{subscription.status}</span></div>
        <p className="mt-3 text-sm text-muted-text">{subscription.cancel_at_period_end ? `Cancellation scheduled: ${cancelDate(subscription.cancel_at)}` : "No period-end cancellation scheduled"}</p>
        <details className="my-4 text-xs text-muted-text"><summary className="cursor-pointer">Price and product items ({subscription.items.length})</summary><ul className="mt-3 space-y-2">{subscription.items.map((item: AdminSubscription["items"][number], index: number): JSX.Element => <li key={index} className="break-all font-mono">{item.price_id} / {item.product_id}</li>)}</ul></details>
        {!["canceled", "incomplete_expired"].includes(subscription.status) && <CancellationControl key={`${userId}-${subscription.id}-${subscription.cancel_at_period_end}`} userId={userId} subscriptionId={subscription.id} scheduled={subscription.cancel_at_period_end} />}
      </article>)}
      <nav aria-label="Subscription pages" className="flex justify-between gap-4">{cursor ? <a className={LINK} href={`/admin?tab=subscriptions&user=${encodeURIComponent(userId)}`}>First page</a> : <span />}{result.data.has_more && result.data.next_cursor && <a className={LINK} href={`/admin?tab=subscriptions&user=${encodeURIComponent(userId)}&cursor=${encodeURIComponent(result.data.next_cursor)}`}>Next page</a>}</nav>
    </section>)}
  </div>;
}

export async function AdminPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<JSX.Element> {
  const params: Record<string, string | string[] | undefined> = await searchParams;
  const tab: string = typeof params.tab === "string" ? params.tab : "plans";
  const page: number = params.page === undefined ? 1 : Number(params.page);
  const edit: string | undefined = typeof params.edit === "string" ? params.edit : undefined;
  const userId: string = typeof params.user === "string" ? params.user.trim() : "";
  const cursor: string | undefined = typeof params.cursor === "string" ? params.cursor : undefined;
  const invalid: boolean = [params.tab, params.page, params.edit, params.user, params.cursor].some((value: unknown): boolean => Array.isArray(value)) || !["plans", "subscriptions", "roles"].includes(tab) || !Number.isInteger(page) || page < 1 || page > 1_000_000 || Boolean(edit && edit.length > 255) || userId.length > 255 || Boolean(cursor && (cursor.length > 255 || !/^sub_[A-Za-z0-9]+$/.test(cursor)));
  return <div className="flex min-h-dvh flex-col bg-background text-foreground"><Navbar variant="dashboard" />
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
      <a href="/dashboard" className="text-xs text-muted-text hover:text-foreground">← Back to deployments</a>
      <h1 className="mt-7 text-[28px] font-semibold tracking-tight sm:text-[32px]">Administration</h1>
      <p className="mt-2 text-sm leading-6 text-muted-text">Manage plans, subscriptions, roles, and access.</p>
      <nav aria-label="Administration sections" className="mb-7 mt-7 flex gap-6 border-b border-surface-border">{SECTIONS.map(([value, label, href]: readonly [string, string, string]): JSX.Element => <a key={value} href={href} aria-current={tab === value ? "page" : undefined} className={`border-b-2 pb-3 text-sm transition-colors ${tab === value ? "border-accent text-foreground" : "border-transparent text-muted-text hover:text-foreground"}`}>{label}</a>)}</nav>
      {invalid ? <ErrorNotice message="These page parameters are invalid. Select a section above to start again." /> : tab === "subscriptions" ? <SubscriptionsSection key={userId} userId={userId} cursor={cursor} /> : tab === "roles" ? <RolesSection edit={edit} userId={userId} /> : <PlansSection page={page} edit={edit} />}
    </main><footer className="mx-auto w-full max-w-6xl px-5 pb-6 font-mono text-[10px] text-muted-dark sm:px-8">Kumo</footer>
  </div>;
}
