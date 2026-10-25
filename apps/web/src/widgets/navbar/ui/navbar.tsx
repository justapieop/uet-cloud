import { Suspense, type JSX } from "react";
import { LoginButton, UserAvatar } from "@/features/auth";
import { getCurrentUser, type CurrentUser } from "@/features/auth/server";

interface NavbarProps {
  readonly variant?: "landing" | "dashboard";
}

async function NavbarAccount(): Promise<JSX.Element> {
  const user: CurrentUser | null = await getCurrentUser();

  return user ? (
    <UserAvatar displayName={user.display_name} />
  ) : (
    <LoginButton variant="navbar" />
  );
}

export function Navbar({ variant = "landing" }: NavbarProps): JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--surface-border)] bg-[var(--background)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-8">
        <a
          href={variant === "landing" ? "#overview" : "/"}
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

        <div className="flex items-center gap-6 sm:gap-8">
          {variant === "landing" && (
            <>
              <nav
                aria-label="Main Navigation"
                className="flex items-center gap-6 sm:gap-8"
              >
                <a
                  href="#features"
                  className="text-sm text-gray-400 transition-colors hover:text-white"
                >
                  Features
                </a>
                <a
                  href="#guide"
                  className="text-sm text-gray-400 transition-colors hover:text-white"
                >
                  Guide
                </a>
              </nav>

              <div
                className="h-4 w-px bg-[var(--surface-border)]"
                aria-hidden="true"
              />
            </>
          )}

          <Suspense
            fallback={
              <span
                role="status"
                aria-label="Loading account"
                className="size-9 shrink-0 rounded-full bg-[var(--surface)]"
              />
            }
          >
            <NavbarAccount />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
