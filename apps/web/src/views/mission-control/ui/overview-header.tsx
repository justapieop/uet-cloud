import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";

interface OverviewHeaderProps {
  readonly deployment: Deployment;
}

const STATUS_CONFIGS: Readonly<Record<Deployment["status"], { readonly label: string; readonly dotClass: string; readonly badgeClass: string }>> = {
  RUNNING: { label: "Running", dotClass: "bg-emerald-400", badgeClass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
  STARTING: { label: "Starting", dotClass: "bg-blue-400 animate-pulse", badgeClass: "border-blue-400/20 bg-blue-400/10 text-blue-300" },
  STOPPING: { label: "Stopping", dotClass: "bg-amber-400 animate-pulse", badgeClass: "border-amber-400/20 bg-amber-400/10 text-amber-300" },
  PROVISIONING: { label: "Provisioning", dotClass: "bg-blue-400 animate-pulse", badgeClass: "border-blue-400/20 bg-blue-400/10 text-blue-300" },
  PENDING: { label: "Pending", dotClass: "bg-amber-400", badgeClass: "border-amber-400/20 bg-amber-400/10 text-amber-300" },
  STOPPED: { label: "Stopped", dotClass: "bg-zinc-400", badgeClass: "border-zinc-400/20 bg-zinc-400/10 text-zinc-300" },
  FAILED: { label: "Failed", dotClass: "bg-red-400", badgeClass: "border-red-400/20 bg-red-400/10 text-red-300" },
  DELETED: { label: "Deleted", dotClass: "bg-zinc-600", badgeClass: "border-zinc-600/20 bg-zinc-600/10 text-muted-text" },
};

function formatDate(value: string): string {
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

export function OverviewHeader({ deployment }: OverviewHeaderProps): JSX.Element {
  const statusConfig: { readonly label: string; readonly dotClass: string; readonly badgeClass: string } =
    STATUS_CONFIGS[deployment.status] ?? STATUS_CONFIGS.PENDING;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-muted-text">
        <a href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</a>
        <span aria-hidden="true" className="text-muted-dark">/</span>
        <a href="/dashboard" className="transition-colors hover:text-foreground">Deployments</a>
        <span aria-hidden="true" className="text-muted-dark">/</span>
        <span aria-current="page" className="font-mono text-foreground">{deployment.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-border pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{deployment.name}</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusConfig.badgeClass}`}>
              <span className={`size-1.5 rounded-full ${statusConfig.dotClass}`} aria-hidden="true" />
              {statusConfig.label}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-text">
            Mission Control <span className="text-muted-dark">•</span> Last synced:{" "}
            <time dateTime={deployment.updated_at}>{formatDate(deployment.updated_at)} UTC</time>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {deployment.fqdn && /^[a-zA-Z0-9.-]+$/.test(deployment.fqdn) ? (
            <a
              href={`https://${deployment.fqdn}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-surface-border bg-surface px-3.5 text-xs font-medium text-blue-300 transition-colors hover:border-blue-400/40 hover:bg-surface-hover hover:text-blue-200"
            >
              <span>Visit application</span>
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ) : (
            <span className="inline-flex h-9 items-center rounded-lg border border-surface-border-subtle bg-white/[0.02] px-3.5 text-xs text-muted-dark">
              No public endpoint
            </span>
          )}
        </div>
      </div>

      {deployment.error && (
        <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 size-5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h2 className="text-sm font-medium text-red-300">Deployment Error</h2>
              <p className="mt-1 font-mono text-xs leading-5 text-red-200/90">{deployment.error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
