import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";

export default function DashboardLoading(): JSX.Element {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main role="status" aria-live="polite" className="mx-auto w-full max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <span className="sr-only">Loading deployments…</span>
        <p className="mb-7 text-xs text-muted-text">Dashboard <span className="mx-2 text-muted-dark">/</span> Deployments</p>
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Deployments</h1>
        <p className="mb-8 mt-2 text-sm text-muted-text">Build, run, and keep track of your applications.</p>
        <div aria-hidden="true" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
          <div className="border-b border-surface-border px-6 py-5 text-sm">All deployments</div>
          <div className="flex gap-3 border-b border-surface-border p-6"><span className="h-10 flex-1 rounded-lg bg-white/5" /><span className="h-10 w-36 rounded-lg bg-white/5" /><span className="hidden h-10 w-36 rounded-lg bg-white/5 sm:block" /></div>
          <div className="divide-y divide-surface-border">{[0, 1, 2].map((row: number): JSX.Element => <div key={row} className="flex items-center gap-4 px-6 py-6"><span className="size-9 rounded-lg bg-white/5" /><span className="h-3 w-1/3 rounded bg-white/5" /><span className="ml-auto h-3 w-20 rounded bg-white/5" /></div>)}</div>
        </div>
      </main>
    </div>
  );
}
