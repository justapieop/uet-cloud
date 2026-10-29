"use client";

import { Button } from "@heroui/react";
import { useEffect, useState, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type SetStateAction } from "react";
import {
  type AttachVolumeInput,
  MOUNT_PATH_REGEX,
  VOLUME_NAME_REGEX,
} from "../model/types";

interface AttachVolumeModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmitVolume: (input: AttachVolumeInput) => void;
  readonly initialValues?: AttachVolumeInput | null;
}

const INPUT_CLASS: string =
  "mt-1.5 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dark focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";
const LABEL_CLASS: string = "block text-xs font-medium text-foreground";

export function AttachVolumeModal({
  isOpen,
  onClose,
  onSubmitVolume,
  initialValues,
}: AttachVolumeModalProps): JSX.Element | null {
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [mountPath, setMountPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [subPath, setSubPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sizeGb, setSizeGb]: [number, Dispatch<SetStateAction<number>>] = useState<number>(5);
  const [accessMode, setAccessMode]: ["ReadWrite" | "ReadOnly", Dispatch<SetStateAction<"ReadWrite" | "ReadOnly">>] = useState<"ReadWrite" | "ReadOnly">("ReadWrite");
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  useEffect((): void => {
    if (initialValues) {
      setName(initialValues.name);
      setMountPath(initialValues.mount_path);
      setSubPath(initialValues.sub_path ?? "");
      setSizeGb(initialValues.size_gb);
      setAccessMode(initialValues.access_mode ?? "ReadWrite");
    }
  }, [initialValues, isOpen]);

  if (!isOpen) return null;

  function resetForm(): void {
    setName("");
    setMountPath("");
    setSubPath("");
    setSizeGb(5);
    setAccessMode("ReadWrite");
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
    const trimmedMount: string = mountPath.trim();
    const trimmedSubPath: string = subPath.trim();

    if (!VOLUME_NAME_REGEX.test(trimmedName)) {
      setErrorMessage("Volume name must be 2–32 lowercase letters, numbers, or hyphens (e.g. data-storage).");
      return;
    }

    if (!MOUNT_PATH_REGEX.test(trimmedMount)) {
      setErrorMessage("Mount path must be an absolute path inside the container starting with / (e.g. /var/data).");
      return;
    }

    if (!Number.isInteger(sizeGb) || sizeGb < 1) {
      setErrorMessage("Volume capacity must be a positive integer in GiB.");
      return;
    }

    const payload: AttachVolumeInput = {
      name: trimmedName,
      mount_path: trimmedMount,
      ...(trimmedSubPath ? { sub_path: trimmedSubPath } : {}),
      size_gb: sizeGb,
      access_mode: accessMode,
    };

    onSubmitVolume(payload);
    resetForm();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-volume-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
        onClick={handleClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-surface-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-surface-border pb-4">
          <div>
            <h2 id="attach-volume-title" className="text-base font-semibold text-foreground">
              Attach Persistent Volume
            </h2>
            <p className="mt-1 text-xs text-muted-text">
              Create an Azure File Share and mount it directly into this deployment&apos;s container.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-muted-text hover:bg-surface-hover hover:text-foreground"
            aria-label="Close dialog"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className={LABEL_CLASS} htmlFor="volume-name">
              Volume name
            </label>
            <input
              id="volume-name"
              className={INPUT_CLASS}
              type="text"
              required
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setName(e.target.value)}
              placeholder="data-storage"
              pattern="[a-z][a-z0-9-]{0,30}[a-z0-9]"
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">2–32 lowercase letters, numbers, or hyphens.</span>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-mount-path">
              Container mount path
            </label>
            <input
              id="volume-mount-path"
              className={INPUT_CLASS}
              type="text"
              required
              value={mountPath}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setMountPath(e.target.value)}
              placeholder="/var/data"
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">Absolute path in container (must start with /).</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="volume-size">
                Capacity (GiB)
              </label>
              <input
                id="volume-size"
                className={INPUT_CLASS}
                type="number"
                required
                min="1"
                step="1"
                value={sizeGb}
                onChange={(e: ChangeEvent<HTMLInputElement>): void => setSizeGb(Number(e.target.value))}
              />
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="volume-access-mode">
                Access mode
              </label>
              <select
                id="volume-access-mode"
                className={INPUT_CLASS}
                value={accessMode}
                onChange={(e: ChangeEvent<HTMLSelectElement>): void =>
                  setAccessMode(e.target.value as "ReadWrite" | "ReadOnly")
                }
              >
                <option value="ReadWrite">ReadWrite</option>
                <option value="ReadOnly">ReadOnly</option>
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-sub-path">
              Subpath <span className="font-normal text-muted-dark">(optional)</span>
            </label>
            <input
              id="volume-sub-path"
              className={INPUT_CLASS}
              type="text"
              value={subPath}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setSubPath(e.target.value)}
              placeholder="e.g. data/uploads"
              autoComplete="off"
            />
          </div>

          {errorMessage && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-surface-border pt-4">
            <Button type="button" variant="ghost" size="sm" onPress={handleClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Attach Volume
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
