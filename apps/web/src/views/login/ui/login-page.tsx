"use client";

import type { JSX } from "react";
import { Card } from "@heroui/react";
import { LoginButton } from "@/features/auth";

export function LoginPage(): JSX.Element {
  const containerClass: string =
    "min-h-dvh flex flex-col bg-background text-foreground";

  const mainClass: string =
    "flex-1 flex items-center justify-center px-4 py-16 sm:px-6 sm:py-24";

  const cardClass: string =
    "w-full max-w-md border border-[var(--surface-border)] bg-[var(--surface)] p-6 sm:p-8 rounded-xl shadow-none";

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
        <Card className={cardClass}>
          <Card.Header className="p-0 pb-6">
            <Card.Title className="text-2xl font-semibold tracking-tight text-white">
              Sign in to Kumo
            </Card.Title>
            <Card.Description className="mt-2 text-sm leading-relaxed text-gray-400">
              Use your GitHub account to manage your applications and deployments.
            </Card.Description>
          </Card.Header>

          <Card.Content className="p-0">
            <LoginButton variant="card" />
          </Card.Content>
        </Card>
      </main>
    </div>
  );
}
