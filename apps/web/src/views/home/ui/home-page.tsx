import type { JSX } from "react";
import { Navbar } from "@/widgets/navbar";
import { HeroSection } from "@/widgets/hero";
import { FeaturesSection } from "@/widgets/features";
import { GuideSection } from "@/widgets/guide";

export function HomePage(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />

      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <GuideSection />
      </main>

      <footer className="border-t border-[var(--surface-border)] py-8 text-center font-mono text-xs text-gray-500">
        Kumo
      </footer>
    </div>
  );
}
