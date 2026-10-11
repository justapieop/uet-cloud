import type { JSX } from "react";

interface NavItem {
  readonly label: string;
  readonly href: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "#overview" },
  { label: "Features", href: "#features" },
  { label: "Guide", href: "#guide" },
  { label: "Difference", href: "#difference" },
];

export function Navbar(): JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--surface-border)] bg-[var(--background)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-8">
        <a
          href="#overview"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
          aria-label="Kumo Home"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-blue-600 font-mono text-xs font-bold text-white shadow-sm shadow-blue-500/30">
            K
          </span>
          <span className="text-base font-bold tracking-tight bg-gradient-to-r from-white via-sky-300 to-blue-400 bg-clip-text text-transparent animate-text-shimmer drop-shadow-[0_0_10px_rgba(59,130,246,0.4)]">
            Kumo
          </span>
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-blue-400">
            PaaS
          </span>
        </a>

        <nav
          aria-label="Main Navigation"
          className="flex items-center gap-5 text-xs sm:gap-7 sm:text-sm font-medium"
        >
          {NAV_ITEMS.map((item: NavItem): JSX.Element => (
            <a
              key={item.href}
              href={item.href}
              className="text-gray-400 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
