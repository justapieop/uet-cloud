"use client";

import { Button } from "@heroui/react";
import { useState, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type SetStateAction } from "react";
import { VOLUME_NAME_REGEX } from "@/features/manage-volume";

interface CreateVolumeModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreateVolume: (volume: { name: string; sizeGb: number; region: string }) => void;
}

const INPUT_CLASS: string =
  "mt-1.5 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dark focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";
const LABEL_CLASS: string = "block text-xs font-medium text-foreground";

export function CreateVolumeModal({ isOpen, onClose, onCreateVolume }: CreateVolumeModalProps): JSX.Element | null {
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sizeGb, setSizeGb]: [number, Dispatch<SetStateAction<number>>] = useState<number>(32);
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  if (!isOpen) return null;

  function resetForm(): void {
    setName("");
    setSizeGb(32);
    setErrorMessage(null);
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedName: string = name.trim();
    if (!VOLUME_NAME_REGEX.test(trimmedName)) {
      setErrorMessage("Volume name must be 2–32 lowercase letters, numbers, or hyphens (e.g. app-data).");
      return;
    }

    if (!Number.isInteger(sizeGb) || sizeGb < 32 || sizeGb > 262144) {
      setErrorMessage("Capacity must be an integer between 32 and 262,144 GiB (256 TiB).");
      return;
    }

    onCreateVolume({
      name: trimmedName,
      sizeGb,
      region: "eastasia",
    });
    handleClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-volume-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
        onClick={handleClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-surface-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4">
          <div>
            <h2 id="create-volume-title" className="text-base font-semibold text-foreground">
              Create persistent volume
            </h2>
            <p className="mt-1 text-xs text-muted-text">
              Provision a new standalone Azure File Share volume for your applications.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-muted-text transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className={LABEL_CLASS} htmlFor="volume-name">
              Volume Name
            </label>
            <input
              id="volume-name"
              className={INPUT_CLASS}
              type="text"
              required
              pattern="[a-z][a-z0-9-]{0,30}[a-z0-9]"
              placeholder="e.g. shared-database"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setName(e.target.value.toLowerCase())}
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">
              2–32 lowercase letters, numbers, or hyphens.
            </span>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-size">
              Capacity (GiB)
            </label>
            <input
              id="volume-size"
              className={INPUT_CLASS}
              type="number"
              required
              min="32"
              max="262144"
              step="1"
              value={sizeGb}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setSizeGb(Number(e.target.value))}
            />
            <span className="mt-1 block text-[11px] text-muted-text">
              Between 32 GiB and 262,144 GiB (256 TiB).
            </span>
          </div>

          {errorMessage && (
            <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-surface-border pt-4">
            <Button type="button" variant="ghost" size="sm" onPress={handleClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Create Volume
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
