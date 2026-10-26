import type { JSX } from "react";
import { RootLoginForm } from "@/features/root-login";

export function RootLoginPage(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-8" aria-labelledby="root-login-title">
        <a href="/" className="text-sm font-semibold">Kumo</a>
        <h1 id="root-login-title" className="mt-6 text-2xl font-semibold tracking-tight">Root sign in</h1>
        <p className="mt-2 text-sm leading-6 text-muted-text">Administrative access for the root account.</p>
        <RootLoginForm />
        <a href="/login" className="mt-6 block text-center text-sm text-muted-text hover:text-foreground">Continue with GitHub</a>
      </section>
    </main>
  );
}
