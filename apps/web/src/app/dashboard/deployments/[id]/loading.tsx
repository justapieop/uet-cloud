import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";

export default function MissionControlLoading(): JSX.Element {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main role="status" aria-live="polite" className="mx-auto w-full max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <span className="sr-only">Loading deployment mission control…</span>
        <div aria-hidden="true" className="space-y-6">
          <div className="h-4 w-48 rounded bg-white/5" />
          <div className="flex items-center justify-between border-b border-surface-border pb-6">
            <div className="space-y-2">
              <div className="h-8 w-64 rounded bg-white/5" />
              <div className="h-3 w-40 rounded bg-white/5" />
            </div>
            <div className="h-9 w-32 rounded bg-white/5" />
          </div>

          <div className="h-48 rounded-xl border border-surface-border bg-surface/40 p-6" />

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64 rounded-xl border border-surface-border bg-surface/40 p-6" />
            <div className="h-64 rounded-xl border border-surface-border bg-surface/40 p-6" />
          </div>

          <div className="h-64 rounded-xl border border-surface-border bg-surface/40 p-6" />
        </div>
      </main>
    </div>
  );
}
