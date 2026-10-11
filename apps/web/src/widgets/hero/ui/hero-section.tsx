import type { JSX } from "react";

export function HeroSection(): JSX.Element {
  return (
    <section
      id="overview"
      className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center opacity-30"
        aria-hidden="true"
      >
        <div className="size-[540px] rounded-full bg-blue-600/15 blur-[120px] animate-pulse-glow" />
      </div>

      <div className="mx-auto max-w-4xl px-6 sm:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3.5 py-1 text-xs font-medium text-blue-400">
          <span className="size-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse" />
          <span>Azure Container Apps Engine · East Asia</span>
        </div>

        <div className="mt-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl sm:leading-[1.1]">
            From Container Image to{" "}
            <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
              Live on Azure in 15 Seconds.
            </span>
          </h1>

          <ul className="mt-6 space-y-2.5 text-sm sm:text-base text-gray-300">
            <li className="flex items-start gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400 text-xs mt-0.5 font-bold">
                ✓
              </span>
              <span>
                <strong className="font-semibold text-white">
                  Zero ARM or Bicep templates
                </strong>{" "}
                — deploy container images directly without config sprawl.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400 text-xs mt-0.5 font-bold">
                ✓
              </span>
              <span>
                <strong className="font-semibold text-white">
                  Strict workload isolation
                </strong>{" "}
                — dedicated{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-blue-300">
                  user-rg-&lt;userId&gt;
                </code>{" "}
                per tenant with zero cross-system bleed.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400 text-xs mt-0.5 font-bold">
                ✓
              </span>
              <span>
                <strong className="font-semibold text-white">
                  Managed ACA runtime
                </strong>{" "}
                — automatic KEDA auto-scaling, ingress, and zero cluster
                maintenance.
              </span>
            </li>
          </ul>

          <div className="mt-10">
            <div className="inline-flex rounded-2xl border border-blue-500/30 bg-blue-950/30 p-1.5 backdrop-blur-sm shadow-xl shadow-blue-950/30">
              <a
                href="/deploy"
                className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-blue-600 px-8 text-base font-bold text-white shadow-lg shadow-blue-600/40 transition-all hover:bg-blue-500 hover:shadow-blue-500/60 sm:h-16 sm:px-10 sm:text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <span>Deploy your application now</span>
                <span className="text-xl leading-none">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
