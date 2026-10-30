"use client";

import { Button } from "@heroui/react";
import type { JSX } from "react";

interface DetachVolumeDialogProps {
  readonly volumeName: string | null;
  readonly mode: "detach" | "delete" | null;
  readonly onClose: () => void;
  readonly onConfirm: (volumeName: string, mode: "detach" | "delete") => void;
}

export function DetachVolumeDialog({
  volumeName,
  mode,
  onClose,
  onConfirm,
}: DetachVolumeDialogProps): JSX.Element | null {
  if (!volumeName || !mode) return null;

  const isDelete: boolean = mode === "delete";

  function handleConfirm(): void {
    if (!volumeName || !mode) return;
    onConfirm(volumeName, mode);
    onClose();
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="detach-volume-title"
      aria-describedby="detach-volume-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
              isDelete
                ? "border-red-500/30 bg-red-500/10 text-red-400 font-bold"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400 font-bold"
            }`}
          >
            !
          </div>
          <div>
            <h2 id="detach-volume-title" className="text-base font-semibold text-foreground">
              {isDelete ? "Permanently delete volume & data?" : "Detach volume from container?"}
            </h2>
            <p id="detach-volume-description" className="mt-2 text-xs leading-5 text-muted-text">
              {isDelete ? (
                <>
                  Volume <span className="font-mono font-medium text-foreground">{volumeName}</span> will be detached
                  from the container and its <strong className="text-red-400">entire data permanently deleted</strong> on
                  the Azure Storage file share. This action <strong className="text-red-400">cannot be undone</strong>.
                </>
              ) : (
                <>
                  Volume <span className="font-mono font-medium text-foreground">{volumeName}</span> will be detached
                  from the container. All files and data remain <strong className="text-foreground">safely preserved</strong> on
                  Azure Storage.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-surface-border pt-4">
          <Button type="button" variant="ghost" size="sm" onPress={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isDelete ? "danger" : "secondary"}
            size="sm"
            onPress={handleConfirm}
          >
            {isDelete ? "Delete Volume" : "Detach Volume"}
          </Button>
        </div>
      </div>
    </div>
  );
}
