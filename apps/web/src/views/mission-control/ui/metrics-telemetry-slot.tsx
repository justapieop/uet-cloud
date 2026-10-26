import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";

interface MetricsTelemetrySlotProps {
  readonly deployment: Deployment;
}

export function MetricsTelemetrySlot({ deployment }: MetricsTelemetrySlotProps): JSX.Element {
  const isRunning: boolean = deployment.status === "RUNNING";

  return (
    <section aria-labelledby="telemetry-heading" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="telemetry-heading" className="text-sm font-medium text-foreground">Live Telemetry & Metrics</h2>
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-blue-300">
              Telemetry Slot
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-text">Real-time Azure Monitor CPU, Memory, and replica scaling signals</p>
        </div>

        <div className="flex items-center gap-2">
          {["1h", "6h", "24h"].map((range: string): JSX.Element => (
            <span
              key={range}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                range === "1h"
                  ? "border-accent bg-accent/10 font-semibold text-blue-300"
                  : "border-surface-border bg-white/[0.02] text-muted-dark"
              }`}
            >
              {range}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-lg border border-surface-border bg-background/50 p-4">
          <div className="flex items-center justify-between text-muted-text">
            <span className="text-[11px] font-medium uppercase tracking-wider">CPU Usage</span>
            <span className="font-mono text-[10px] text-muted-dark">cores</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-semibold text-muted-text">—</span>
            <span className="font-mono text-xs text-muted-dark">/ {deployment.max_vcpu ?? "—"} cores</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-dark">Per-replica average utilization</p>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-surface-border bg-background/50 p-4">
          <div className="flex items-center justify-between text-muted-text">
            <span className="text-[11px] font-medium uppercase tracking-wider">Memory Working Set</span>
            <span className="font-mono text-[10px] text-muted-dark">MiB</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-semibold text-muted-text">—</span>
            <span className="font-mono text-xs text-muted-dark">/ {deployment.max_memory ? `${deployment.max_memory} GiB` : "—"}</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-dark">Per-replica memory footprint</p>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-surface-border bg-background/50 p-4">
          <div className="flex items-center justify-between text-muted-text">
            <span className="text-[11px] font-medium uppercase tracking-wider">Active Replicas</span>
            <span className="font-mono text-[10px] text-muted-dark">instances</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-semibold text-muted-text">—</span>
            <span className="font-mono text-xs text-muted-dark">
              ({deployment.min_scaling ?? 0}–{deployment.max_scaling ?? 1} max)
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-dark">Dynamic scale instance count</p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-surface-border-subtle bg-white/[0.015] p-5 text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-lg border border-surface-border bg-surface text-blue-300">
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <h3 className="mt-3 text-xs font-medium text-foreground">
          {isRunning ? "Live telemetry integration in progress" : `Telemetry paused (${deployment.status})`}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-dark">
          {isRunning
            ? "Azure Monitor time-series telemetry charts (CPU, memory, replica scaling) will automatically render here once the pipeline is active."
            : "Azure Monitor metrics are only collected while a Container App is in RUNNING status."}
        </p>
      </div>
    </section>
  );
}
