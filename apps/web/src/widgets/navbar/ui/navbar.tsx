import type { JSX } from "react";

export function Navbar(): JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--surface-border)] bg-[var(--background)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-8">
        <a
          href="#overview"
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
      </div>
    </header>
  );
}
