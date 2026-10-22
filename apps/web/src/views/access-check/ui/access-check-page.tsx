import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";

interface AccessCheckPageProps {
  readonly retryHref: string;
  readonly forbidden?: boolean;
}

export function AccessCheckPage({ retryHref, forbidden = false }: AccessCheckPageProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-6 py-16 sm:px-8">
        <section role="alert" className="w-full max-w-md rounded-xl border border-surface-border bg-surface p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">We couldn&apos;t verify your subscription</h1>
          <p className="mt-3 text-sm leading-6 text-muted-text">
            {forbidden
              ? "Your account cannot access subscription details. Try signing in again."
              : "Subscription verification is temporarily unavailable. Try again before selecting another plan."}
          </p>
          <a href={forbidden ? "/auth/login" : retryHref} className="mt-6 inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500">
            {forbidden ? "Sign in again" : "Try again"}
          </a>
        </section>
      </main>
    </div>
  );
}