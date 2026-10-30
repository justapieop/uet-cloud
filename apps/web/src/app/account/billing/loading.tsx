import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";

export default function BillingLoading(): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main
        role="status"
        aria-live="polite"
        className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-8 sm:py-16"
      >
        <span className="sr-only">Loading billing information…</span>
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-xs text-muted-text">
          <span>Dashboard</span>
          <span aria-hidden="true" className="text-muted-dark">/</span>
          <span aria-current="page" className="text-foreground">Billing</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
          <p className="mt-3 text-sm leading-6 text-muted-text">
            Loading your current plan and subscription status.
          </p>
        </header>

        <div aria-hidden="true" className="space-y-8">
          <section className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
            <div className="border-b border-surface-border px-5 py-4 sm:px-6">
              <span className="block h-4 w-28 rounded bg-white/5" />
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-4 rounded-lg border border-surface-border bg-background/60 p-5">
                <span className="block h-4 w-32 rounded bg-white/5" />
                <span className="block h-3 w-full rounded bg-white/5" />
                <span className="block h-3 w-4/5 rounded bg-white/5" />
                <span className="block h-3 w-3/5 rounded bg-white/5" />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
            <div className="border-b border-surface-border px-5 py-4 sm:px-6">
              <span className="block h-4 w-28 rounded bg-white/5" />
            </div>
            <div className="divide-y divide-surface-border">
              {[0, 1].map((row: number): JSX.Element => (
                <div key={row} className="space-y-3 p-5">
                  <span className="block h-3 w-40 rounded bg-white/5" />
                  <span className="block h-3 w-56 rounded bg-white/5" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <footer className="border-t border-surface-border py-6 text-center font-mono text-xs text-muted-dark">
        Kumo
      </footer>
    </div>
  );
}
