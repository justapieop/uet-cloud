"use client";

import { useState, useTransition, type Dispatch, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { Button, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { VolumeItem } from "@/entities/volume";
import { createStandaloneVolumeAction, deleteStandaloneVolumeAction } from "@/features/manage-volume/api/volume-actions";
import type { VolumeActionResult } from "@/features/manage-volume";
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
  const router: AppRouterInstance = useRouter();
  const [isRefreshing, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [isCreateOpen, setIsCreateOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [targetDeleteVolume, setTargetDeleteVolume]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pendingVolumes, setPendingVolumes]: [VolumeItem[], Dispatch<SetStateAction<VolumeItem[]>>] = useState<VolumeItem[]>([]);
  const [deletingVolumeNames, setDeletingVolumeNames]: [string[], Dispatch<SetStateAction<string[]>>] = useState<string[]>([]);
  const [deletedVolumeNames, setDeletedVolumeNames]: [string[], Dispatch<SetStateAction<string[]>>] = useState<string[]>([]);

  function handleRefresh(): void {
    startTransition((): void => {
      setDeletedVolumeNames([]);
      setPendingVolumes([]);
      router.refresh();
    });
  }

  async function handleCreateVolume(input: { readonly name: string; readonly sizeGb: number; readonly region: string }): Promise<void> {
    const now: string = new Date().toISOString();
    const optimisticVolume: VolumeItem = {
      id: `pending-${input.name}-${Date.now()}`,
      name: input.name,
      size_gb: input.sizeGb,
      region: input.region,
      created_at: now,
      updated_at: now,
      attached_deployments: [],
    };

    setPendingVolumes((prev: VolumeItem[]): VolumeItem[] => [optimisticVolume, ...prev]);
    toast.info(`Creating volume "${input.name}"...`);

    const result: VolumeActionResult = await createStandaloneVolumeAction({
      name: input.name,
      size_gb: input.sizeGb,
      region: input.region,
    });

    if (result.success) {
      toast.success(`Volume "${input.name}" created successfully.`);
      startTransition((): void => {
        router.refresh();
      });
    } else {
      setPendingVolumes((prev: VolumeItem[]): VolumeItem[] => prev.filter((v: VolumeItem): boolean => v.name !== input.name));
      toast.danger(result.error ?? `Failed to create volume "${input.name}".`);
    }
  }

  async function handleDeleteVolume(volumeName: string): Promise<void> {
    setDeletingVolumeNames((prev: string[]): string[] => [...prev, volumeName]);
    toast.info(`Deleting volume "${volumeName}"...`);

    const result: VolumeActionResult = await deleteStandaloneVolumeAction(volumeName);

    if (result.success) {
      setDeletingVolumeNames((prev: string[]): string[] => prev.filter((n: string): boolean => n !== volumeName));
      setDeletedVolumeNames((prev: string[]): string[] => [...prev, volumeName]);
      toast.success(`Volume "${volumeName}" deleted.`);
      startTransition((): void => {
        router.refresh();
      });
    } else {
      setDeletingVolumeNames((prev: string[]): string[] => prev.filter((n: string): boolean => n !== volumeName));
      toast.danger(result.error ?? `Failed to delete volume "${volumeName}".`);
    }
  }

  const activePendingVolumes: VolumeItem[] = pendingVolumes.filter(
    (pending: VolumeItem): boolean => !volumes.some((serverVol: VolumeItem): boolean => serverVol.name === pending.name),
  );

  const effectiveVolumes: VolumeItem[] = [
    ...activePendingVolumes,
    ...volumes.filter((vol: VolumeItem): boolean => !deletedVolumeNames.includes(vol.name)),
  ];

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
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            className="h-10 rounded-lg px-3.5 text-xs font-medium text-foreground"
            isDisabled={isRefreshing}
            onPress={handleRefresh}
          >
            <svg
              className={`size-3.5 ${isRefreshing ? "animate-spin text-accent" : "text-muted-text"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </Button>
          <button
            type="button"
            onClick={(): void => setIsCreateOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <span aria-hidden="true">+</span> Create volume
          </button>
        </div>
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
                  const isCreating: boolean = activePendingVolumes.some((pv: VolumeItem): boolean => pv.name === volume.name);
                  const isDeleting: boolean = deletingVolumeNames.includes(volume.name);
                  const isMounted: boolean = volume.attached_deployments.length > 0;
                  const rowClass: string = isDeleting
                    ? "align-top transition-all opacity-50 pointer-events-none"
                    : isCreating
                      ? "align-top transition-colors bg-accent/[0.02]"
                      : "align-top transition-colors hover:bg-white/[0.02]";

                  return (
                    <tr key={volume.id} className={rowClass}>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border border-surface-border font-mono text-xs ${isCreating ? "animate-pulse bg-accent/10 text-accent" : "bg-background/50 text-accent"}`}>
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
                        {isCreating ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent font-medium animate-pulse">
                            <span className="size-1.5 rounded-full bg-accent animate-ping" />
                            <span>Creating…</span>
                          </span>
                        ) : isDeleting ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400 font-medium animate-pulse">
                            <span className="size-1.5 rounded-full bg-red-400" />
                            <span>Deleting…</span>
                          </span>
                        ) : isMounted ? (
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
                        {isCreating ? (
                          <span className="text-xs text-muted-dark">
                            Provisioning…
                          </span>
                        ) : isDeleting ? (
                          <span className="text-xs text-red-400/70">
                            Deleting…
                          </span>
                        ) : isMounted ? (
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

      <CreateVolumeModal
        isOpen={isCreateOpen}
        onClose={(): void => setIsCreateOpen(false)}
        onCreateVolume={handleCreateVolume}
      />
      <DeleteVolumeModal
        volumeName={targetDeleteVolume}
        onClose={(): void => setTargetDeleteVolume(null)}
        onConfirmDelete={handleDeleteVolume}
      />
    </>
  );
}
