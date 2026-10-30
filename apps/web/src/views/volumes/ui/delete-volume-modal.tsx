"use client";

import { Button } from "@heroui/react";
import { useState, type Dispatch, type JSX, type SetStateAction } from "react";
import { deleteStandaloneVolumeAction } from "@/features/manage-volume/api/volume-actions";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

interface DeleteVolumeModalProps {
  readonly volumeName: string | null;
  readonly onClose: () => void;
}

export function DeleteVolumeModal({ volumeName, onClose }: DeleteVolumeModalProps): JSX.Element | null {
  const router: AppRouterInstance = useRouter();
  const [isDeleting, setIsDeleting]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  if (!volumeName) return null;

  async function handleConfirmDelete(): Promise<void> {
    if (!volumeName) return;
    setIsDeleting(true);
    setErrorMessage(null);

    const result = await deleteStandaloneVolumeAction(volumeName);
    if (!result.success) {
      setIsDeleting(false);
      setErrorMessage(result.error ?? "Failed to delete volume.");
    } else {
      setIsDeleting(false);
      onClose();
      router.refresh();
    }
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

        {errorMessage && (
          <div role="alert" className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-300">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-surface-border pt-4">
          <Button type="button" variant="ghost" size="sm" onPress={onClose} isDisabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="danger" size="sm" onPress={handleConfirmDelete} isDisabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete Volume"}
          </Button>
        </div>
      </div>
    </div>
  );
}
