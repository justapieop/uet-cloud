import type { JSX } from "react";

interface ComparisonItem {
  readonly manual: string;
  readonly kumo: string;
}

const COMPARISONS: readonly ComparisonItem[] = [
  {
    manual:
      "Writing 300+ lines of complex ARM / Bicep JSON templates and manual parameter files.",
    kumo: "Zero templates — simply point to your Docker / OCI container image URL.",
  },
  {
    manual:
      "Manual Resource Group setup with constant risk of polluting core system resources.",
    kumo: "Automated user-rg-<userId> provisioning with strict tenant-level isolation.",
  },
  {
    manual:
      "Manual VNet routing, Subnet setup, Ingress rules, and custom TLS certificate renewals.",
    kumo: "Instant public HTTPS FQDN endpoint with fully managed automated TLS out of the box.",
  },
  {
    manual:
      "Complex Kubernetes cluster maintenance and paying for idle VM compute around the clock.",
    kumo: "Serverless ACA runtime with native KEDA scale-to-zero when traffic stops.",
  },
];

export function DifferenceSection(): JSX.Element {
  return (
    <section
      id="difference"
      className="relative border-t border-[var(--surface-border)] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="max-w-4xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            From Manual to Automated Deployment
          </h2>
          <p className="mt-3 max-w-2xl text-base text-gray-400 sm:text-lg">
            Deploying to Azure Container Apps shouldn&apos;t require an
            infrastructure engineering degree.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="flex flex-col justify-between rounded-2xl border border-rose-500/20 bg-gradient-to-br from-[#160c10] to-[#0d070a] p-7">
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-400">
                  The Manual Azure Way
                </span>
                <span className="font-mono text-xs text-rose-400/70">
                  Painful &amp; Slow
                </span>
              </div>

              <h3 className="mt-5 text-xl font-bold text-white">
                Complex cloud overhead
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                Fighting against infrastructure boilerplate instead of shipping
                features.
              </p>

              <ul className="mt-6 space-y-4 text-sm text-gray-400">
                {COMPARISONS.map((item: ComparisonItem): JSX.Element => (
                  <li key={item.manual} className="flex items-start gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400 text-xs font-bold mt-0.5">
                      ✕
                    </span>
                    <span className="line-through decoration-rose-500/40">
                      {item.manual}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-blue-500/30 bg-gradient-to-br from-[#0c1424] to-[#080d18] p-7 shadow-xl shadow-blue-950/20">
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400">
                  The Kumo PaaS Way
                </span>
                <span className="font-mono text-xs text-emerald-400 font-semibold">
                  Automated &amp; Instant
                </span>
              </div>

              <h3 className="mt-5 text-xl font-bold text-white">
                Developer-first velocity
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                Bring your container image and let Kumo operate the underlying
                Azure infrastructure.
              </p>

              <ul className="mt-6 space-y-4 text-sm text-gray-200">
                {COMPARISONS.map((item: ComparisonItem): JSX.Element => (
                  <li key={item.kumo} className="flex items-start gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold mt-0.5">
                      ✓
                    </span>
                    <span className="font-medium text-white">{item.kumo}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
