"use client";

import { Button } from "@heroui/react";
import { useState, useTransition, type Dispatch, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Deployment } from "@/entities/deployment";
import type { AttachVolumeInput, DeploymentVolume, VolumeActionResult } from "../model/types";
import { attachVolumeAction, detachVolumeAction } from "../api/actions";
import { AttachVolumeModal } from "./attach-volume-modal";
import { DetachVolumeDialog } from "./detach-volume-dialog";

interface StorageVolumesCardProps {
  readonly deployment: Deployment;
}

interface PendingAttachment {
  readonly volume: AttachVolumeInput;
  readonly status: "attaching" | "error";
  readonly errorMessage?: string;
}

interface PendingVolumeOperation {
  readonly volumeName: string;
  readonly mode: "detach" | "delete";
  readonly status: "in-progress" | "error";
  readonly errorMessage?: string;
}

export function StorageVolumesCard({ deployment }: StorageVolumesCardProps): JSX.Element {
  const router: AppRouterInstance = useRouter();
  const [isAttachOpen, setIsAttachOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [targetVolume, setTargetVolume]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [dialogMode, setDialogMode]: ["detach" | "delete" | null, Dispatch<SetStateAction<"detach" | "delete" | null>>] = useState<"detach" | "delete" | null>(null);
  const [pendingAttachment, setPendingAttachment]: [PendingAttachment | null, Dispatch<SetStateAction<PendingAttachment | null>>] = useState<PendingAttachment | null>(null);
  const [pendingOperation, setPendingOperation]: [PendingVolumeOperation | null, Dispatch<SetStateAction<PendingVolumeOperation | null>>] = useState<PendingVolumeOperation | null>(null);
  const [, startTransition]: [boolean, TransitionStartFunction] = useTransition();

  const volumes: readonly DeploymentVolume[] = deployment.volumes ?? [];
  const isEditable: boolean = deployment.status === "RUNNING" || deployment.status === "STOPPED";
  const isAttaching: boolean = pendingAttachment?.status === "attaching";
  const isModifying: boolean = pendingOperation?.status === "in-progress";
  const isOperating: boolean = isAttaching || isModifying;
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

  function handleStartAttach(input: AttachVolumeInput): void {
    setPendingAttachment({ volume: input, status: "attaching" });

    startTransition(async (): Promise<void> => {
      const result: VolumeActionResult = await attachVolumeAction(deployment.id, input);
      if (!result.success) {
        setPendingAttachment({
          volume: input,
          status: "error",
          errorMessage: result.error ?? "Failed to attach volume. Please try again.",
        });
      } else {
        setPendingAttachment(null);
        router.refresh();
      }
    });
  }

  function handleRetryAttach(): void {
    setIsAttachOpen(true);
  }

  function handleDismissAttachError(): void {
    setPendingAttachment(null);
  }

  function handleStartDetachOrDelete(volumeName: string, mode: "detach" | "delete"): void {
    const isDelete: boolean = mode === "delete";
    setPendingOperation({ volumeName, mode, status: "in-progress" });

    startTransition(async (): Promise<void> => {
      const result: VolumeActionResult = await detachVolumeAction(deployment.id, volumeName, isDelete);
      if (!result.success) {
        setPendingOperation({
          volumeName,
          mode,
          status: "error",
          errorMessage: result.error ?? `Failed to ${mode} volume. Please try again.`,
        });
      } else {
        setPendingOperation(null);
        router.refresh();
      }
    });
  }

  function handleRetryOperation(): void {
    if (!pendingOperation) return;
    const retryVolume: string = pendingOperation.volumeName;
    const retryMode: "detach" | "delete" = pendingOperation.mode;
    setPendingOperation(null);
    setTargetVolume(retryVolume);
    setDialogMode(retryMode);
  }

  function handleDismissOperationError(): void {
    setPendingOperation(null);
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
            isDisabled={!isEditable || isOperating}
            onPress={(): void => setIsAttachOpen(true)}
            aria-label="Attach new volume"
          >
            {isAttaching ? "Attaching Volume…" : "+ Attach Volume"}
          </Button>
        </div>
      </div>

      {!isEditable && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
          <span className="font-bold">!</span>
          <span>
            Volumes can only be attached, detached, or deleted when the deployment is in <strong>RUNNING</strong> or <strong>STOPPED</strong> status.
          </span>
        </div>
      )}

      {pendingAttachment?.status === "error" && (
        <div
          role="alert"
          className="mt-4 flex flex-col justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-red-400">!</span>
            <span>{pendingAttachment.errorMessage}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="ghost" size="sm" onPress={handleRetryAttach}>
              Retry
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={handleDismissAttachError}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {pendingOperation?.status === "error" && (
        <div
          role="alert"
          className="mt-4 flex flex-col justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-red-400">!</span>
            <span>{pendingOperation.errorMessage}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="ghost" size="sm" onPress={handleRetryOperation}>
              Retry
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={handleDismissOperationError}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {volumes.length === 0 && !isAttaching ? (
        <div className="mt-5 rounded-lg border border-dashed border-surface-border p-6 text-center">
          <p className="text-xs text-muted-text">No persistent storage volumes attached to this deployment.</p>
          {isEditable && (
            <p className="mt-1 text-[11px] text-muted-dark">
              Click &ldquo;+ Attach Volume&rdquo; above to create and mount persistent storage.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {isAttaching && pendingAttachment && (
            <div className="flex flex-col justify-between gap-4 rounded-lg border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {pendingAttachment.volume.name}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-300">
                    <span className="inline-block size-1.5 animate-ping rounded-full bg-blue-400" />
                    ATTACHING...
                  </span>
                  <span className="font-mono text-xs text-muted-text">
                    {pendingAttachment.volume.size_gb} GiB
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-text">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase text-muted-dark">Mount:</span>
                    <span className="rounded bg-surface px-1.5 py-0.5 text-foreground">
                      {pendingAttachment.volume.mount_path}
                    </span>
                  </div>

                  {pendingAttachment.volume.sub_path && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase text-muted-dark">Subpath:</span>
                      <span className="text-muted-text">{pendingAttachment.volume.sub_path}</span>
                    </div>
                  )}
                </div>

                <p className="pt-1 text-[11px] text-muted-dark">
                  Provisioning Azure File Share and updating Container App revision… You can continue using Mission Control while this runs.
                </p>
              </div>
            </div>
          )}

          {volumes.map((vol: DeploymentVolume): JSX.Element => {
            const isReadOnly: boolean = vol.access_mode === "ReadOnly";
            const isThisVolumeOperating: boolean =
              pendingOperation !== null &&
              pendingOperation.volumeName === vol.name &&
              pendingOperation.status === "in-progress";
            const operationMode: "detach" | "delete" | undefined =
              pendingOperation !== null && isThisVolumeOperating
                ? pendingOperation.mode
                : undefined;

            return (
              <div
                key={vol.name}
                className={`flex flex-col justify-between gap-4 rounded-lg border p-4 sm:flex-row sm:items-center transition-colors ${
                  isThisVolumeOperating
                    ? operationMode === "delete"
                      ? "border-red-500/40 bg-red-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                    : "border-surface-border bg-background/50"
                }`}
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

                    {isThisVolumeOperating && operationMode === "detach" && (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-300">
                        <span className="inline-block size-1.5 animate-ping rounded-full bg-amber-400" />
                        DETACHING...
                      </span>
                    )}

                    {isThisVolumeOperating && operationMode === "delete" && (
                      <span className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-red-400">
                        <span className="inline-block size-1.5 animate-ping rounded-full bg-red-400" />
                        DELETING...
                      </span>
                    )}
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

                  {isThisVolumeOperating && (
                    <p className="pt-1 text-[11px] text-muted-dark">
                      {operationMode === "delete"
                        ? "Detaching volume and deleting Azure file share data… You can continue using Mission Control while this runs."
                        : "Detaching volume from container and updating Container App revision… You can continue using Mission Control while this runs."}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    isDisabled={!isEditable || isOperating}
                    onPress={(): void => openDetachDialog(vol.name)}
                    aria-label={`Detach volume ${vol.name}`}
                  >
                    {isThisVolumeOperating && operationMode === "detach" ? "Detaching…" : "Detach"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isDisabled={!isEditable || isOperating}
                    onPress={(): void => openDeleteDialog(vol.name)}
                    aria-label={`Delete volume and data ${vol.name}`}
                  >
                    {isThisVolumeOperating && operationMode === "delete" ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AttachVolumeModal
        isOpen={isAttachOpen}
        onClose={(): void => setIsAttachOpen(false)}
        onSubmitVolume={handleStartAttach}
        initialValues={pendingAttachment?.status === "error" ? pendingAttachment.volume : null}
      />

      <DetachVolumeDialog
        volumeName={targetVolume}
        mode={dialogMode}
        onClose={closeDialog}
        onConfirm={handleStartDetachOrDelete}
      />
    </section>
  );
}
