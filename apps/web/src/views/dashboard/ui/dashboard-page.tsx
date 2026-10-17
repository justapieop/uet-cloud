import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";

export function DashboardPage(): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-8">
        <h1 className="sr-only">Dashboard</h1>
      </main>

      <footer className="border-t border-[var(--surface-border)] py-8 text-center font-mono text-xs text-gray-500">
        Kumo
      </footer>
    </div>
  );
}
