import type { JSX } from "react";

interface FeatureCard {
  readonly title: string;
  readonly description: string;
  readonly tag: string;
  readonly tagColor: string;
}

const PRIMARY_FEATURES: readonly FeatureCard[] = [
  {
    title: "Dedicated Tenant Workload Isolation",
    description:
      "Every deployed application runs strictly inside an isolated user-rg-<userId>. Deployments into the system core are hard-blocked by design.",
    tag: "Security Isolation",
    tagColor: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  {
    title: "KEDA Event-Driven Auto-Scaling",
    description:
      "Scale from 0 to N replicas seamlessly. Applications sleep when idle to eliminate cost and scale automatically on incoming traffic spikes.",
    tag: "Scale to Zero",
    tagColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  },
];

export function FeaturesSection(): JSX.Element {
  return (
    <section
      id="features"
      className="relative border-t border-[var(--surface-border)] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Platform capabilities built for production.
          </h2>
          <p className="mt-3 text-base text-gray-400 sm:text-lg">
            Every architectural decision in Kumo is designed to abstract Azure
            Container Apps while enforcing enterprise cloud standards.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col justify-between rounded-2xl border border-blue-500/20 bg-gradient-to-br from-[#111322] to-[#0a0c16] p-7 transition-all hover:border-blue-500/40">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PRIMARY_FEATURES[0].tagColor}`}
                >
                  {PRIMARY_FEATURES[0].tag}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  user-rg-&lt;userId&gt;
                </span>
              </div>
              <h3 className="mt-4 text-xl font-bold text-white">
                {PRIMARY_FEATURES[0].title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                {PRIMARY_FEATURES[0].description}
              </p>
            </div>

            <div className="mt-8 rounded-xl border border-white/5 bg-black/40 p-4 font-mono text-xs">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-blue-400">rg: user-rg-dev-9182</span>
                <span className="text-emerald-400">isolated</span>
              </div>
              <div className="mt-2.5 space-y-1.5 text-gray-500">
                <div className="flex items-center justify-between rounded bg-white/5 px-2.5 py-1 text-gray-300">
                  <span>app-backend (ACA)</span>
                  <span className="text-emerald-400">100% tenant bound</span>
                </div>
                <div className="flex items-center justify-between rounded bg-white/5 px-2.5 py-1 text-gray-300">
                  <span>system-rg ingress</span>
                  <span className="text-rose-400">access denied (blocked)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-purple-500/20 bg-gradient-to-br from-[#151024] to-[#0c0916] p-7 transition-all hover:border-purple-500/40">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PRIMARY_FEATURES[1].tagColor}`}
                >
                  {PRIMARY_FEATURES[1].tag}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  KEDA on ACA
                </span>
              </div>
              <h3 className="mt-4 text-xl font-bold text-white">
                {PRIMARY_FEATURES[1].title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                {PRIMARY_FEATURES[1].description}
              </p>
            </div>

            <div className="mt-8 rounded-xl border border-white/5 bg-black/40 p-4">
              <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                <span>Traffic Scale Curve</span>
                <span className="text-purple-400">0 → 8 Replicas</span>
              </div>
              <div className="mt-3 flex items-end gap-1.5 h-14">
                <div className="h-2 w-full rounded bg-purple-950" />
                <div className="h-4 w-full rounded bg-purple-900" />
                <div className="h-8 w-full rounded bg-purple-700" />
                <div className="h-14 w-full rounded bg-purple-500 shadow-sm shadow-purple-500/50" />
                <div className="h-10 w-full rounded bg-purple-600" />
                <div className="h-3 w-full rounded bg-purple-900" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
