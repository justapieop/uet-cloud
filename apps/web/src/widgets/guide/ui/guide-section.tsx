import type { JSX } from "react";

interface GuideStep {
  readonly action: string;
  readonly detail: string;
}

const STEPS: readonly GuideStep[] = [
  {
    action: "Paste your image",
    detail: "From Docker Hub, GitHub Packages, or Azure Container Registry.",
  },
  {
    action: "Set resources",
    detail: "CPU, memory, port, and scaling limits.",
  },
  {
    action: "Get your URL",
    detail: "A live HTTPS endpoint on Azure Container Apps, ready to go.",
  },
];

export function GuideSection(): JSX.Element {
  return (
    <section
      id="guide"
      className="border-t border-[var(--surface-border)] py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Three steps to deploy your application
        </h2>

        <div className="mt-14 flex flex-col items-center gap-4 md:flex-row md:items-stretch md:gap-0">
          {STEPS.map(
            (step: GuideStep, i: number): JSX.Element => (
              <div key={step.action} className="flex w-full flex-col items-center gap-4 md:w-auto md:flex-1 md:flex-row md:gap-0">
                <div className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] p-5">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-2xl font-semibold leading-none text-blue-600/60">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {step.action}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-gray-400">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                </div>

                {i < STEPS.length - 1 && (
                  <>
                    <span
                      className="block shrink-0 font-mono text-lg text-gray-600 md:hidden"
                      aria-hidden="true"
                    >
                      ↓
                    </span>
                    <span
                      className="hidden shrink-0 px-4 font-mono text-lg text-gray-600 md:block"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
