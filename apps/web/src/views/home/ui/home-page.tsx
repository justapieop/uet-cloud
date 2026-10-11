import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";
import { HeroSection } from "@/widgets/hero";
import { FeaturesSection } from "@/widgets/features";
import { DifferenceSection } from "@/widgets/difference";
import { HowItWorksSection } from "@/widgets/how-it-works";

export function HomePage(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />

      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <DifferenceSection />
      </main>

      <footer className="border-t border-[var(--surface-border)] py-8 text-center text-xs text-gray-500 font-mono">
        Kumo · The PaaS for Azure Container Apps
      </footer>
    </div>
  );
}
