import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";
import { DashboardNav } from "@/widgets/dashboard-nav";
import { LoginButton } from "@/features/auth";
import type { VolumesResult } from "@/entities/volume/server";
import { VolumesView } from "./volumes-view";

interface VolumesPageProps {
  readonly result: VolumesResult;
}

export function VolumesPage({ result }: VolumesPageProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-xs text-muted-text">
          <a href="/dashboard" className="transition-colors hover:text-foreground">
            Dashboard
          </a>
          <span aria-hidden="true" className="text-muted-dark">
            /
          </span>
          <span aria-current="page" className="text-foreground">
            Volumes
          </span>
        </nav>

        <DashboardNav activeTab="volumes" />

        {result.kind === "unauthorized" ? (
          <div className="flex min-h-80 flex-col items-center justify-center px-6 py-16 text-center">
            <span
              aria-hidden="true"
              className="mb-5 flex size-12 items-center justify-center rounded-xl border border-surface-border bg-background font-mono text-lg text-muted-text"
            >
              K
            </span>
            <h3 className="text-base font-medium">Your workspace is waiting</h3>
            <p className="mb-6 mt-2 max-w-xs text-sm leading-6 text-muted-text">
              Sign in with GitHub to view and manage your persistent storage volumes.
            </p>
            <LoginButton variant="navbar" label="Continue with GitHub" />
          </div>
        ) : result.kind === "error" ? (
          <div role="alert" className="m-5 rounded-lg border border-red-400/15 bg-red-400/5 px-5 py-4 sm:m-6">
            <h3 className="text-sm font-medium text-red-300">Unable to load volumes</h3>
            <p className="mt-1 text-sm leading-6 text-muted-text">{result.message}</p>
          </div>
        ) : (
          <VolumesView volumes={result.volumes} />
        )}
      </main>
    </div>
  );
}
