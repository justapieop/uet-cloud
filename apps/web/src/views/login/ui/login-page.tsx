"use client";

import type { JSX } from "react";
import { Card } from "@heroui/react";
import { LoginButton } from "@/features/auth";

export function LoginPage(): JSX.Element {
  const containerClass: string =
    "min-h-screen flex flex-col bg-background text-foreground";

  const mainClass: string =
    "flex-1 flex items-center justify-center px-4 py-16 sm:px-6 sm:py-24";

  const cardWrapperClass: string = "w-full max-w-md";

  const cardClass: string =
    "border border-[var(--surface-border)] bg-[var(--surface)] p-6 sm:p-8 rounded-xl shadow-none";

  return (
    <div className={containerClass}>
      <header className="border-b border-[var(--surface-border)] bg-[var(--background)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-8">
          <a
            href="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
            aria-label="Kumo Home"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 font-mono text-xs font-bold text-white">
              K
            </span>
            <span className="text-base font-semibold tracking-tight text-white">
              Kumo
            </span>
          </a>

          <a
            href="/"
            className="text-xs font-mono text-gray-400 transition-colors hover:text-white"
          >
            ← Back to Home
          </a>
        </div>
      </header>

      <main className={mainClass}>
        <div className={cardWrapperClass}>
          <div className="mb-4 flex items-center justify-between font-mono text-[11px] text-gray-500 uppercase tracking-wider">
            <span>[ AUTH // OAUTH2 ]</span>
            <span>PROT // HTTPS</span>
          </div>

          <Card className={cardClass}>
            <Card.Header className="p-0 pb-6">
              <Card.Title className="text-2xl font-semibold tracking-tight text-white">
                Sign in to Kumo
              </Card.Title>
              <Card.Description className="mt-2 text-sm leading-relaxed text-gray-400">
                Authenticate with your GitHub account to manage container apps and access the cloud console.
              </Card.Description>
            </Card.Header>

            <Card.Content className="p-0 space-y-4">
              <LoginButton variant="card" />

              <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-hover)] p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="font-mono text-xs text-blue-500 mt-0.5">ℹ</span>
                  <p className="text-xs leading-relaxed text-gray-400">
                    GitHub OAuth requests only the <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px] text-gray-300">read:user</code> scope for profile identification.
                  </p>
                </div>
              </div>
            </Card.Content>

            <Card.Footer className="p-0 pt-6 mt-6 border-t border-[var(--surface-border)]">
              <p className="text-center w-full text-xs text-gray-500 leading-normal">
                By continuing, you agree to Kumo&apos;s platform guidelines and security policies.
              </p>
            </Card.Footer>
          </Card>
        </div>
      </main>

      <footer className="border-t border-[var(--surface-border)] py-8 text-center font-mono text-xs text-gray-500">
        Kumo
      </footer>
    </div>
  );
}
