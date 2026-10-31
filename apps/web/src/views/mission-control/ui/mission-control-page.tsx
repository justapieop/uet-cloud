import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";
import { Navbar } from "@/widgets/navbar";
import { OverviewHeader } from "./overview-header";
import { ComputeSpecCard } from "./compute-spec-card";
import { NetworkTopologyCard } from "./network-topology-card";
import { InfrastructureMetaCard } from "./infrastructure-meta-card";
import { MetricsTelemetrySlot } from "./metrics-telemetry-slot";
import { StorageVolumesCard } from "@/features/manage-volume";

interface MissionControlPageProps {
  readonly deployment: Deployment;
}

export function MissionControlPage({ deployment }: MissionControlPageProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <OverviewHeader deployment={deployment} />

        <div className="mt-8 space-y-6">
          <MetricsTelemetrySlot deployment={deployment} />

          <div className="grid gap-6 lg:grid-cols-2">
            <ComputeSpecCard deployment={deployment} />
            <NetworkTopologyCard deployment={deployment} />
          </div>

          <StorageVolumesCard deployment={deployment} />

          <InfrastructureMetaCard deployment={deployment} />
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl justify-between gap-4 px-5 pb-6 font-mono text-[10px] text-muted-dark sm:px-8">
        <span>Kumo Mission Control</span>
        <a href="/dashboard" className="text-muted-dark transition-colors hover:text-foreground">
          Back to Deployments
        </a>
      </footer>
    </div>
  );
}
