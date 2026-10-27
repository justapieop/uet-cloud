import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";
import { DEPLOYMENT_STATUSES, type Deployment, type DeploymentFilters as Filters } from "@/entities/deployment";
import { getDeployments, type DeploymentsResult } from "@/entities/deployment/server";
import { DeploymentFilters } from "@/features/filter-deployments";
import { DeploymentActionButton } from "@/features/manage-deployment";
import { LoginButton } from "@/features/auth";

interface DashboardPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STATUS_STYLES: Readonly<Record<Deployment["status"], string>> = {
  PENDING: "text-amber-300", PROVISIONING: "text-blue-300",
  STARTING: "text-blue-300", STOPPING: "text-amber-300",
  RUNNING: "text-emerald-300", STOPPED: "text-amber-400", FAILED: "text-red-300", DELETED: "text-muted-text",
};

function formatDate(value: string): string {
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

export async function DashboardPage({ searchParams }: DashboardPageProps): Promise<JSX.Element> {
  const params: Record<string, string | string[] | undefined> = await searchParams;
  const name: string | undefined = typeof params.name === "string" ? params.name.trim() : undefined;
  const status: Deployment["status"] | undefined = DEPLOYMENT_STATUSES.find((value: Deployment["status"]): boolean => value === params.status);
  const region: string | undefined = typeof params.region === "string" ? params.region.trim().toLowerCase() : undefined;
  const filters: Filters = { name: name || undefined, status, region: region || undefined };
  const invalid: boolean = Array.isArray(params.name) || Array.isArray(params.status) || Array.isArray(params.region) ||
    (params.status !== undefined && status === undefined);
  const result: DeploymentsResult = invalid
    ? { kind: "error", message: "These filters are invalid. Reset your filters and try again." }
    : await getDeployments(filters);
  const filtered: boolean = Boolean(filters.name || filters.status || filters.region);
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-xs text-muted-text">
          <a href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</a>
          <span aria-hidden="true" className="text-muted-dark">/</span>
          <span aria-current="page" className="text-foreground">Deployments</span>
        </nav>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">Deployments</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-text">Build, run, and keep track of your applications.</p>
          </div>
          <a href="/dashboard/create" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"><span aria-hidden="true">+</span> Create deployment</a>
        </div>
        {typeof params.created === "string" && result.kind === "success" && result.deployments.some((deployment: Deployment): boolean => deployment.id === params.created) && <p role="status" className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-5 py-4 text-sm text-emerald-200">Deployment accepted. Its current status is shown below. Refresh the list to check progress.</p>}
        <section aria-label="Deployments" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
          <div className="flex min-h-16 items-center justify-between gap-4 border-b border-surface-border px-5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-medium">{filtered ? "Filtered deployments" : "All deployments"}</h2>
              {result.kind === "success" && <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-text">{result.deployments.length}</span>}
            </div>
            {result.kind === "success" && <span className="text-xs text-muted-dark">Newest first</span>}
          </div>
          {result.kind !== "unauthorized" && <DeploymentFilters key={JSON.stringify(filters)} filters={filters} clearable={params.name !== undefined || params.status !== undefined || params.region !== undefined} />}
          {result.kind === "unauthorized" ? (
            <div className="flex min-h-80 flex-col items-center justify-center px-6 py-16 text-center">
              <span aria-hidden="true" className="mb-5 flex size-12 items-center justify-center rounded-xl border border-surface-border bg-background font-mono text-lg text-muted-text">K</span>
              <h3 className="text-base font-medium">Your workspace is waiting</h3>
              <p className="mb-6 mt-2 max-w-xs text-sm leading-6 text-muted-text">Sign in with GitHub to view and manage your deployments.</p>
              <LoginButton variant="navbar" label="Continue with GitHub" />
            </div>
          ) : result.kind === "error" ? (
            <div role="alert" className="m-5 rounded-lg border border-red-400/15 bg-red-400/5 px-5 py-4 sm:m-6">
              <h3 className="text-sm font-medium text-red-300">Unable to load deployments</h3>
              <p className="mt-1 text-sm leading-6 text-muted-text">{result.message}</p>
            </div>
          ) : result.deployments.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
              <span aria-hidden="true" className="mb-5 flex size-11 items-center justify-center rounded-xl border border-surface-border bg-background font-mono text-sm text-muted-text">{filtered ? "0" : "/"}</span>
              <h3 className="text-base font-medium">{filtered ? "No deployments match these filters" : "A home for your applications"}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-text">{filtered ? "Try a different name, status, or region, or reset your filters." : "Once you create your first deployment, its status and configuration will appear here."}</p>
              {!filtered && <a href="/dashboard/create" className="mt-6 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Create your first deployment</a>}
            </div>
          ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-sm min-w-[960px]">
                  <caption className="sr-only">Your deployments, newest first</caption>
                  <colgroup><col className="w-[30%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[18%]" /><col className="w-[14%]" /><col className="w-[12%]" /></colgroup>
                  <thead className="border-b border-surface-border bg-white/[0.015] text-[11px] text-muted-text">
                    <tr>{["Application", "Status", "Region", "Configuration", "Last updated", "Actions"].map((heading: string): JSX.Element => <th key={heading} scope="col" className="px-6 py-3.5 font-medium">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {result.deployments.map((deployment: Deployment): JSX.Element => (
                      <tr key={deployment.id} className="align-top transition-colors hover:bg-white/[0.02]">
                        <td className="px-6 py-5">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <a href={`/dashboard/deployments/${deployment.id}`} className="block truncate text-[13px] font-medium text-foreground transition-colors hover:text-blue-300" title={`Mission Control for ${deployment.name}`}>{deployment.name}</a>
                              {deployment.fqdn && /^[a-zA-Z0-9.-]+$/.test(deployment.fqdn) ? <a href={`https://${deployment.fqdn}`} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-xs text-muted-text transition-colors hover:text-blue-300" title={deployment.fqdn}>{deployment.fqdn}</a> : <p className="mt-1 text-xs text-muted-dark">No public endpoint</p>}
                              {deployment.image && <p className="mt-1 truncate font-mono text-[10px] text-muted-dark" title={deployment.image}>{deployment.image}</p>}
                              {deployment.error && <details className="mt-2 text-xs"><summary className="w-fit cursor-pointer text-red-300 transition-colors hover:text-red-200">View error</summary><p className="mt-2 break-words rounded-md border border-red-400/15 bg-red-400/5 p-3 leading-5 text-red-200/80">{deployment.error}</p></details>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5"><span className={`inline-flex items-center gap-2 whitespace-nowrap text-xs ${STATUS_STYLES[deployment.status]}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{deployment.status.charAt(0) + deployment.status.slice(1).toLowerCase()}</span></td>
                        <td className="px-6 py-5 font-mono text-[11px] text-muted-text">{deployment.region ?? "—"}</td>
                        <td className="px-6 py-5"><p className="whitespace-nowrap text-xs text-muted-text">{deployment.max_vcpu ?? "—"} vCPU <span className="mx-1 text-muted-dark">/</span> {deployment.max_memory ?? "—"} GiB</p><p className="mt-1.5 text-[11px] text-muted-dark">{deployment.min_scaling ?? "—"}–{deployment.max_scaling ?? "—"} replicas</p></td>
                        <td className="px-6 py-5 text-[11px] leading-5 text-muted-text"><time dateTime={deployment.updated_at}>{formatDate(deployment.updated_at)}</time><span className="block text-[10px] text-muted-dark">UTC</span></td>
                        <td className="px-6 py-5"><DeploymentActionButton id={deployment.id} status={deployment.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          )}
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl justify-between gap-4 px-5 pb-6 font-mono text-[10px] text-muted-dark sm:px-8">
        <span>Kumo</span>
      </footer>
    </div>
  );
}
