"use client";

import { useState, type Dispatch, type JSX, type SetStateAction } from "react";
import type { VolumeItem } from "@/entities/volume";
import { CreateVolumeModal } from "./create-volume-modal";
import { DeleteVolumeModal } from "./delete-volume-modal";

interface VolumesViewProps {
  readonly volumes: VolumeItem[];
}

function formatDate(value: string): string {
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

export function VolumesView({ volumes }: VolumesViewProps): JSX.Element {
  const [isCreateOpen, setIsCreateOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [targetDeleteVolume, setTargetDeleteVolume]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [deletedVolumeNames, setDeletedVolumeNames]: [string[], Dispatch<SetStateAction<string[]>>] = useState<string[]>([]);

  const effectiveVolumes: VolumeItem[] = volumes.filter((vol: VolumeItem): boolean => !deletedVolumeNames.includes(vol.name));
  const totalStorageGb: number = effectiveVolumes.reduce((sum: number, vol: VolumeItem): number => sum + vol.size_gb, 0);
  const totalAttachments: number = effectiveVolumes.reduce((sum: number, vol: VolumeItem): number => sum + vol.attached_deployments.length, 0);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">Storage Volumes</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-text">
            Persistent Azure File Shares to store files and state across container restarts and revisions.
          </p>
        </div>
        <button
          type="button"
          onClick={(): void => setIsCreateOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <span aria-hidden="true">+</span> Create volume
        </button>
      </div>

      {effectiveVolumes.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-surface-border bg-surface/40 p-4">
            <span className="text-xs text-muted-text">Total Volumes</span>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{effectiveVolumes.length}</p>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface/40 p-4">
            <span className="text-xs text-muted-text">Total Allocated Storage</span>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{totalStorageGb} GiB</p>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface/40 p-4">
            <span className="text-xs text-muted-text">Active Container Mounts</span>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{totalAttachments}</p>
          </div>
        </div>
      )}

      <section aria-label="Volumes" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-surface-border px-5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-medium">All persistent volumes</h2>
            <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-text">
              {effectiveVolumes.length}
            </span>
          </div>
          <span className="text-xs text-muted-dark">Newest first</span>
        </div>

        {effectiveVolumes.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-surface-border bg-background/60 text-muted-text">
              <svg className="size-6 text-muted-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zm0 5h16M7 8h.01M7 16h.01" />
              </svg>
            </div>
            <h3 className="text-base font-medium">No storage volumes created yet</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-text">
              Persistent volumes preserve your container files across updates, scaling, and restarts.
            </p>
            <button
              type="button"
              onClick={(): void => setIsCreateOpen(true)}
              className="mt-6 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Create your first volume
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm min-w-[800px]">
              <caption className="sr-only">Your storage volumes</caption>
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="border-b border-surface-border bg-white/[0.015] text-[11px] text-muted-text">
                <tr>
                  <th scope="col" className="px-6 py-3.5 font-medium">
                    Volume
                  </th>
                  <th scope="col" className="px-6 py-3.5 font-medium">
                    Capacity
                  </th>
                  <th scope="col" className="px-6 py-3.5 font-medium">
                    Region
                  </th>
                  <th scope="col" className="px-6 py-3.5 font-medium">
                    Mounted Containers
                  </th>
                  <th scope="col" className="px-6 py-3.5 font-medium text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {effectiveVolumes.map((volume: VolumeItem): JSX.Element => {
                  const isMounted: boolean = volume.attached_deployments.length > 0;
                  return (
                    <tr key={volume.id} className="align-top transition-colors hover:bg-white/[0.02]">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-background/50 font-mono text-xs text-accent">
                            vol
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm font-medium text-foreground">{volume.name}</p>
                            <p className="mt-0.5 text-xs text-muted-dark">Created {formatDate(volume.created_at)}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-5 font-mono text-xs text-foreground">
                        {volume.size_gb} GiB
                      </td>

                      <td className="px-6 py-5">
                        <span className="inline-flex items-center rounded-md border border-surface-border bg-surface px-2 py-0.5 text-xs text-muted-text">
                          {volume.region}
                        </span>
                      </td>

                      <td className="px-6 py-5">
                        {isMounted ? (
                          <div className="flex flex-wrap gap-1.5">
                            {volume.attached_deployments.map((dep): JSX.Element => (
                              <a
                                key={dep.id}
                                href={`/dashboard/deployments/${dep.id}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300 transition-colors hover:bg-blue-500/20"
                                title={`View deployment ${dep.name}`}
                              >
                                <span className="size-1.5 rounded-full bg-blue-400" />
                                <span>{dep.name}</span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 font-medium">
                            Unattached
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-5 text-right">
                        {isMounted ? (
                          <span
                            className="cursor-not-allowed text-xs text-muted-dark"
                            title="Volume is currently mounted to active containers. Detach it from all containers before deleting."
                          >
                            In use (detach first)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(): void => setTargetDeleteVolume(volume.name)}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateVolumeModal isOpen={isCreateOpen} onClose={(): void => setIsCreateOpen(false)} />
      <DeleteVolumeModal
        volumeName={targetDeleteVolume}
        onClose={(): void => setTargetDeleteVolume(null)}
        onDeleted={(deletedName: string): void => setDeletedVolumeNames((prev: string[]): string[] => [...prev, deletedName])}
      />
    </>
  );
}
