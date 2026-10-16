import type { JSX } from "react";

export function HeroSection(): JSX.Element {
  return (
    <section
      id="overview"
      className="relative border-b border-[var(--surface-border)] pt-16 pb-20 sm:pt-24 sm:pb-28"
    >
      <div className="mx-auto max-w-5xl px-6 sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl sm:leading-[1.1]">
            <span>Containers on Azure,</span>
            <span className="block mt-1">zero boilerplate</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-gray-400 sm:text-lg">
            Paste an image, pick resources, get a live HTTPS endpoint on Azure
            Container Apps.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <a
              href="/login"
              className="inline-flex h-11 items-center rounded-lg bg-blue-600 px-6 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:scale-[0.98]"
            >
              Start deploying
            </a>
            <a
              href="#features"
              className="inline-flex h-11 items-center rounded-lg border border-[var(--surface-border)] px-6 text-sm font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white active:scale-[0.98]"
            >
              Learn more
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
