import type { JSX } from "react";

interface DashboardNavProps {
  readonly activeTab: "deployments" | "volumes";
}

export function DashboardNav({ activeTab }: DashboardNavProps): JSX.Element {
  return (
    <nav aria-label="Dashboard views" className="mb-8 flex items-center gap-2 border-b border-surface-border">
      <a
        href="/dashboard"
        className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
          activeTab === "deployments"
            ? "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-accent"
            : "text-muted-text hover:text-foreground"
        }`}
      >
        <svg
          className="size-4 shrink-0 text-muted-dark group-hover:text-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
          />
        </svg>
        <span>Deployments</span>
      </a>

      <a
        href="/dashboard/volumes"
        className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
          activeTab === "volumes"
            ? "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-accent"
            : "text-muted-text hover:text-foreground"
        }`}
      >
        <svg
          className="size-4 shrink-0 text-muted-dark group-hover:text-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zm0 5h16M7 8h.01M7 16h.01"
          />
        </svg>
        <span>Volumes</span>
      </a>
    </nav>
  );
}
