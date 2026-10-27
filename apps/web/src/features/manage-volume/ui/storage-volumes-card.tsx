"use client";

import { Button } from "@heroui/react";
import { useState, type Dispatch, type JSX, type SetStateAction } from "react";
import type { Deployment } from "@/entities/deployment";
import type { DeploymentVolume } from "../model/types";
import { AttachVolumeModal } from "./attach-volume-modal";
import { DetachVolumeDialog } from "./detach-volume-dialog";

interface StorageVolumesCardProps {
  readonly deployment: Deployment;
}

export function StorageVolumesCard({ deployment }: StorageVolumesCardProps): JSX.Element {
  const [isAttachOpen, setIsAttachOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [targetVolume, setTargetVolume]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [dialogMode, setDialogMode]: ["detach" | "delete" | null, Dispatch<SetStateAction<"detach" | "delete" | null>>] = useState<"detach" | "delete" | null>(null);

  const volumes: readonly DeploymentVolume[] = deployment.volumes ?? [];
  const isEditable: boolean = deployment.status === "RUNNING" || deployment.status === "STOPPED";
  const totalDiskGb: number = volumes.reduce((sum: number, vol: DeploymentVolume): number => sum + vol.size_gb, 0);

  function openDetachDialog(volumeName: string): void {
    setTargetVolume(volumeName);
    setDialogMode("detach");
  }

  function openDeleteDialog(volumeName: string): void {
    setTargetVolume(volumeName);
    setDialogMode("delete");
  }

  function closeDialog(): void {
    setTargetVolume(null);
    setDialogMode(null);
  }

  return (
    <section
      aria-labelledby="storage-volumes-heading"
      className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="storage-volumes-heading" className="text-sm font-medium text-foreground">
              Persistent Storage Volumes
            </h2>
            <span className="rounded-full border border-surface-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-text">
              {volumes.length} {volumes.length === 1 ? "volume" : "volumes"} • {totalDiskGb} GiB
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-text">
            Azure File Shares mounted directly into container file paths
          </p>
        </div>

        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isDisabled={!isEditable}
            onPress={(): void => setIsAttachOpen(true)}
            aria-label="Gắn volume mới"
          >
            + Gắn Volume
          </Button>
        </div>
      </div>

      {!isEditable && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
          <span className="font-bold">!</span>
          <span>
            Volume chỉ có thể thêm, gỡ hoặc xoá khi deployment ở trạng thái <strong>RUNNING</strong> hoặc <strong>STOPPED</strong>.
          </span>
        </div>
      )}

      {volumes.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-surface-border p-6 text-center">
          <p className="text-xs text-muted-text">Chưa có persistent volume nào được gắn vào deployment này.</p>
          {isEditable && (
            <p className="mt-1 text-[11px] text-muted-dark">
              Nhấn &ldquo;+ Gắn Volume&rdquo; ở trên để tạo và mount volume lưu trữ vĩnh viễn.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {volumes.map((vol: DeploymentVolume): JSX.Element => {
            const isReadOnly: boolean = vol.access_mode === "ReadOnly";
            return (
              <div
                key={vol.name}
                className="flex flex-col justify-between gap-4 rounded-lg border border-surface-border bg-background/50 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">{vol.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${
                        isReadOnly
                          ? "border border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      }`}
                    >
                      {vol.access_mode ?? "ReadWrite"}
                    </span>
                    <span className="font-mono text-xs text-muted-text">{vol.size_gb} GiB</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-text">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase text-muted-dark">Mount:</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-foreground">{vol.mount_path}</span>
                    </div>

                    {vol.sub_path && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase text-muted-dark">Subpath:</span>
                        <span className="text-muted-text">{vol.sub_path}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    isDisabled={!isEditable}
                    onPress={(): void => openDetachDialog(vol.name)}
                    aria-label={`Gỡ volume ${vol.name}`}
                  >
                    Gỡ volume
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isDisabled={!isEditable}
                    onPress={(): void => openDeleteDialog(vol.name)}
                    aria-label={`Xoá volume và dữ liệu ${vol.name}`}
                  >
                    Xoá
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AttachVolumeModal
        deploymentId={deployment.id}
        isOpen={isAttachOpen}
        onClose={(): void => setIsAttachOpen(false)}
      />

      <DetachVolumeDialog
        deploymentId={deployment.id}
        volumeName={targetVolume}
        mode={dialogMode}
        onClose={closeDialog}
      />
    </section>
  );
}
