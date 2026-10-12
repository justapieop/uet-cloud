import type { JSX } from "react";

interface Capability {
  readonly title: string;
  readonly description: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    title: "Tenant isolation",
    description:
      "Every app runs in a dedicated resource group. Workloads never share infrastructure.",
  },
  {
    title: "Scale to zero",
    description:
      "Containers pause when idle, restart on the next request. Pay only for what runs.",
  },
  {
    title: "Managed HTTPS",
    description:
      "Every deploy gets a live domain with automatic SSL. No DNS or cert config.",
  },
  {
    title: "No servers to manage",
    description:
      "No clusters, no patches, no runtime config. Azure handles the container lifecycle.",
  },
];

export function FeaturesSection(): JSX.Element {
  return (
    <section id="features" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          What you get
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-gray-400 sm:text-base">
          Everything to run containers on Azure without touching
          infrastructure.
        </p>

        <div className="mt-14 grid grid-cols-1 gap-x-16 gap-y-10 sm:grid-cols-2">
          {CAPABILITIES.map(
            (cap: Capability): JSX.Element => (
              <div key={cap.title} className="border-t border-[var(--surface-border)] pt-6">
                <h3 className="text-base font-semibold text-white">
                  {cap.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  {cap.description}
                </p>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
