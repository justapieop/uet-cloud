import type { JSX } from "react";
import type { Deployment } from "@/entities/deployment";

interface NetworkTopologyCardProps {
  readonly deployment: Deployment;
}

export function NetworkTopologyCard({ deployment }: NetworkTopologyCardProps): JSX.Element {
  const targetPort: number | null = deployment.target_port;
  const additionalPorts: readonly { readonly target_port: number; readonly exposed_port: number; readonly external: boolean }[] =
    deployment.additional_ports ?? [];

  return (
    <section aria-labelledby="network-heading" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="border-b border-surface-border pb-4">
        <h2 id="network-heading" className="text-sm font-medium text-foreground">Network & Ports</h2>
        <p className="mt-0.5 text-xs text-muted-text">Ingress entrypoints and internal TCP port mappings</p>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Primary HTTPS Ingress</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-foreground">
              {targetPort !== null ? targetPort : "—"}
            </span>
            <span className="font-mono text-xs text-muted-text">TCP target</span>
          </div>
        </div>

        <div className="rounded-lg border border-surface-border bg-background/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-text">Additional TCP Ports</span>
            <span className="font-mono text-[11px] text-muted-text">{additionalPorts.length} / 5</span>
          </div>

          {additionalPorts.length === 0 ? (
            <p className="mt-3 text-xs text-muted-dark">No additional TCP port mappings configured.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-surface-border/60 text-muted-text">
                    <th scope="col" className="pb-2 font-medium">Target</th>
                    <th scope="col" className="pb-2 font-medium">Exposed</th>
                    <th scope="col" className="pb-2 font-medium">Accessibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border/40 font-mono">
                  {additionalPorts.map((port: { readonly target_port: number; readonly exposed_port: number; readonly external: boolean }, index: number): JSX.Element => (
                    <tr key={`${port.target_port}-${port.exposed_port}-${index}`}>
                      <td className="py-2 text-foreground">{port.target_port}</td>
                      <td className="py-2 text-muted-text">{port.exposed_port}</td>
                      <td className="py-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${port.external ? "bg-amber-400/10 text-amber-300" : "bg-white/[0.04] text-muted-text"}`}>
                          {port.external ? "External VNet" : "Environment Internal"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
