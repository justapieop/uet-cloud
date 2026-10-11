import type { JSX } from "react";

interface WorkflowStep {
  readonly step: string;
  readonly title: string;
  readonly description: string;
  readonly badge: string;
  readonly detailSnippet: string;
}

const STEPS: readonly WorkflowStep[] = [
  {
    step: "Step 1",
    title: "Authenticate & Provide Image",
    description:
      "Sign in with GitHub OAuth2 and point to your container image hosted on GitHub Container Registry (GHCR), Docker Hub, or Azure ACR.",
    badge: "Source Input",
    detailSnippet: "ghcr.io/org/app:v1.4.0",
  },
  {
    step: "Step 2",
    title: "Configure Spec & Scaling",
    description:
      "Set your target port, CPU/RAM sizing (from 0.25 vCPU), environment variables, and define min/max replicas for KEDA auto-scaling.",
    badge: "Resource Spec",
    detailSnippet: "port: 8080 · cpu: 0.25 · scale: 0..4",
  },
  {
    step: "Step 3",
    title: "Instant Live on Azure ACA",
    description:
      "Kumo provisions your dedicated user-rg-<userId>, connects into the shared East Asia ACA environment, and provides an HTTPS FQDN endpoint.",
    badge: "Active Endpoint",
    detailSnippet: "https://app-7821.eastasia.azurecontainerapps.io",
  },
];

export function HowItWorksSection(): JSX.Element {
  return (
    <section
      id="guide"
      className="relative border-t border-[var(--surface-border)] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            How to deploy in 3 steps.
          </h2>
          <p className="mt-3 text-base text-gray-400 sm:text-lg">
            Follow this simple guide to deploy your containerized app to Azure
            Container Apps.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((item: WorkflowStep): JSX.Element => (
            <div
              key={item.step}
              className="relative flex flex-col justify-between rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-7 transition-all hover:border-blue-500/30"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xl sm:text-3xl font-black tracking-tight text-blue-500/90">
                    {item.step}
                  </span>
                  <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-400">
                    {item.badge}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-bold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  {item.description}
                </p>
              </div>

              <div className="mt-8 rounded-xl border border-white/5 bg-black/50 p-3 font-mono text-xs text-gray-300">
                <span className="text-gray-500">$ </span>
                <span className="text-blue-300">{item.detailSnippet}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
