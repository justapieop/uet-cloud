import type { JSX } from "react";
import { getDeployment, type DeploymentResult } from "@/entities/deployment/server";
import { LoginButton } from "@/features/auth";
import { MissionControlPage } from "@/views/mission-control";
import { Navbar } from "@/widgets/navbar";

interface MissionControlRouteProps {
  readonly params: Promise<{ readonly id: string }>;
}

const UUID_PATTERN: RegExp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function MissionControlRoute({ params }: MissionControlRouteProps): Promise<JSX.Element> {
  const resolvedParams: { readonly id: string } = await params;
  const id: string = resolvedParams.id;

  if (!UUID_PATTERN.test(id)) {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <Navbar variant="dashboard" />
        <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 py-16 sm:px-8">
          <div className="flex max-w-md flex-col items-center text-center">
            <span aria-hidden="true" className="mb-5 flex size-12 items-center justify-center rounded-xl border border-surface-border bg-surface font-mono text-lg text-muted-text">!</span>
            <h1 className="text-lg font-medium text-foreground">Invalid Deployment Identifier</h1>
            <p className="mt-2 text-sm leading-6 text-muted-text">The requested deployment ID is malformed or invalid.</p>
            <a href="/dashboard" className="mt-6 inline-flex h-9 items-center rounded-lg bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover">
              Return to Deployments
            </a>
          </div>
        </main>
      </div>
    );
  }

  const result: DeploymentResult = await getDeployment(id);

  if (result.kind === "unauthorized") {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <Navbar variant="dashboard" />
        <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 py-16 sm:px-8">
          <div className="flex max-w-sm flex-col items-center text-center">
            <span aria-hidden="true" className="mb-5 flex size-12 items-center justify-center rounded-xl border border-surface-border bg-surface font-mono text-lg text-muted-text">K</span>
            <h1 className="text-base font-medium text-foreground">Sign in to view Mission Control</h1>
            <p className="mb-6 mt-2 text-sm leading-6 text-muted-text">Authenticate with GitHub to access this deployment&apos;s telemetry and configuration.</p>
            <LoginButton variant="navbar" label="Continue with GitHub" />
          </div>
        </main>
      </div>
    );
  }

  if (result.kind === "not_found") {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <Navbar variant="dashboard" />
        <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 py-16 sm:px-8">
          <div className="flex max-w-md flex-col items-center text-center">
            <span aria-hidden="true" className="mb-5 flex size-12 items-center justify-center rounded-xl border border-surface-border bg-surface font-mono text-lg text-muted-text">404</span>
            <h1 className="text-lg font-medium text-foreground">Deployment Not Found</h1>
            <p className="mt-2 text-sm leading-6 text-muted-text">This deployment either does not exist or you do not have permission to inspect it.</p>
            <a href="/dashboard" className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-hover">
              Return to Deployments
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <Navbar variant="dashboard" />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-16 sm:px-8">
          <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-6">
            <h1 className="text-base font-medium text-red-300">Unable to load Mission Control</h1>
            <p className="mt-2 text-sm text-muted-text">{result.message}</p>
            <div className="mt-5 flex gap-3">
              <a href={`/dashboard/deployments/${id}`} className="inline-flex h-8 items-center rounded-md bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover">
                Retry
              </a>
              <a href="/dashboard" className="inline-flex h-8 items-center rounded-md px-3 text-xs text-muted-text transition-colors hover:text-foreground">
                Back to Deployments
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <MissionControlPage deployment={result.deployment} />;
}
