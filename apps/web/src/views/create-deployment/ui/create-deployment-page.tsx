import type { JSX } from "react";
import { CreateDeploymentForm } from "@/features/create-deployment";
import { Navbar } from "@/widgets/navbar";

export function CreateDeploymentPage(): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <nav aria-label="Breadcrumb" className="mb-7 flex flex-wrap items-center gap-2 text-xs text-muted-text">
          <a href="/dashboard" className="transition-colors hover:text-foreground">Deployments</a><span aria-hidden="true" className="text-muted-dark">/</span><span aria-current="page" className="text-foreground">Create deployment</span>
        </nav>
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Create deployment</h1>
        <p className="mb-8 mt-2 text-sm leading-6 text-muted-text">Build from your repository and run your application on Kumo.</p>
        <CreateDeploymentForm />
      </main>
      <footer className="mx-auto w-full max-w-3xl px-5 pb-6 font-mono text-[10px] text-muted-dark sm:px-8">Kumo</footer>
    </div>
  );
}
