import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";

interface ComputeSpecCardProps {
  readonly deployment: Deployment;
}

export function ComputeSpecCard({ deployment }: ComputeSpecCardProps): JSX.Element {
  const vcpu: number | null = deployment.max_vcpu;
  const memory: number | null = deployment.max_memory;
  const minReplicas: number | null = deployment.min_scaling;
  const maxReplicas: number | null = deployment.max_scaling;

  return (
    <section aria-labelledby="compute-specs-heading" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-surface-border pb-4">
        <div>
          <h2 id="compute-specs-heading" className="text-sm font-medium text-foreground">Compute & Scaling</h2>
          <p className="mt-0.5 text-xs text-muted-text">Allocated replica hardware quotas & auto-scale boundaries</p>
        </div>
        <span className="rounded-md border border-surface-border bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-muted-text">
          ACA Consumption
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">vCPU per replica</span>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-foreground">
            {vcpu !== null ? `${vcpu}` : "—"}
            <span className="ml-1 text-sm font-normal text-muted-text">cores</span>
          </p>
          <p className="mt-2 text-[11px] text-muted-dark">Dedicated virtual core reservation</p>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Memory per replica</span>
            <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              1:2 ratio
            </span>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-foreground">
            {memory !== null ? `${memory}` : "—"}
            <span className="ml-1 text-sm font-normal text-muted-text">GiB</span>
          </p>
          <p className="mt-2 text-[11px] text-muted-dark">Fixed 1:2 memory-to-vCPU allocation</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-surface-border bg-background/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Replica Scaling Bounds</span>
          <span className="text-xs text-muted-text">
            {minReplicas === 0 ? "Scale-to-zero idle allowed" : "Warm stand-by enforced"}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-xl font-semibold text-foreground">{minReplicas !== null ? minReplicas : "—"}</span>
            <span className="text-xs text-muted-dark">min</span>
          </div>
          <span className="text-muted-dark">—</span>
          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-xl font-semibold text-foreground">{maxReplicas !== null ? maxReplicas : "—"}</span>
            <span className="text-xs text-muted-dark">max</span>
          </div>
          <span className="text-xs text-muted-text">replicas</span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-blue-500"
            style={{ width: maxReplicas && maxReplicas > 0 ? `${Math.min(100, (maxReplicas / 10) * 100)}%` : "20%" }}
          />
        </div>
      </div>
    </section>
  );
}
