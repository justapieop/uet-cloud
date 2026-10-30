"use client";

import { Button } from "@heroui/react";
import type { JSX } from "react";

interface DeleteVolumeModalProps {
  readonly volumeName: string | null;
  readonly onClose: () => void;
  readonly onConfirmDelete: (volumeName: string) => void;
}

export function DeleteVolumeModal({ volumeName, onClose, onConfirmDelete }: DeleteVolumeModalProps): JSX.Element | null {
  if (!volumeName) return null;

  function handleConfirm(): void {
    if (!volumeName) return;
    onConfirmDelete(volumeName);
    onClose();
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-volume-title"
      aria-describedby="delete-volume-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 font-bold">
            !
          </div>
          <div>
            <h2 id="delete-volume-title" className="text-base font-semibold text-foreground">
              Permanently delete volume?
            </h2>
            <p id="delete-volume-description" className="mt-2 text-xs leading-5 text-muted-text">
              Volume <span className="font-mono font-medium text-foreground">{volumeName}</span> and its underlying
              Azure File Share will be <strong className="text-red-400">permanently deleted</strong>. All stored data
              will be lost. This action <strong className="text-red-400">cannot be undone</strong>.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-surface-border pt-4">
          <Button type="button" variant="ghost" size="sm" onPress={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" size="sm" onPress={handleConfirm}>
            Delete Volume
          </Button>
        </div>
      </div>
    </div>
  );
}
