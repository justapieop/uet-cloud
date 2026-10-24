import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";

interface InfrastructureMetaCardProps {
  readonly deployment: Deployment;
}

function formatDate(value: string): string {
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

export function InfrastructureMetaCard({ deployment }: InfrastructureMetaCardProps): JSX.Element {
  return (
    <section aria-labelledby="infra-heading" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-surface-border pb-4">
        <div>
          <h2 id="infra-heading" className="text-sm font-medium text-foreground">Build & Environment Metadata</h2>
          <p className="mt-0.5 text-xs text-muted-text">Artifact provenance and regional deployment details</p>
        </div>
        <span className="rounded-md border border-surface-border bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-muted-text">
          Metadata
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Region</span>
          <p className="mt-1.5 font-mono text-sm font-medium text-foreground">
            {deployment.region ?? "Default (southeastasia)"}
          </p>
          <p className="mt-1 text-[11px] text-muted-dark">Deployment workload region</p>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Build Pipeline ID</span>
          <p className="mt-1.5 truncate font-mono text-xs font-medium text-foreground" title={deployment.build_id ?? undefined}>
            {deployment.build_id ?? "Direct image or pending"}
          </p>
          <p className="mt-1 text-[11px] text-muted-dark">Internal tracking identifier</p>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4 sm:col-span-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Container Image</span>
          <p className="mt-1.5 break-all font-mono text-xs font-medium text-foreground">
            {deployment.image ?? "Pending image build resolution"}
          </p>
          <p className="mt-1 text-[11px] text-muted-dark">Resolved registry address and commit tag</p>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Created At</span>
          <p className="mt-1.5 text-xs text-foreground">
            <time dateTime={deployment.created_at}>{formatDate(deployment.created_at)} UTC</time>
          </p>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Last Updated</span>
          <p className="mt-1.5 text-xs text-foreground">
            <time dateTime={deployment.updated_at}>{formatDate(deployment.updated_at)} UTC</time>
          </p>
        </div>
      </div>
    </section>
  );
}
