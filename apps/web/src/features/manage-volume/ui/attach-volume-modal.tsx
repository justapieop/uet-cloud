"use client";

import { Button } from "@heroui/react";
import { useEffect, useState, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type SetStateAction } from "react";
import type { VolumeItem } from "@/entities/volume";
import {
  type AttachVolumeInput,
  MOUNT_PATH_REGEX,
  VOLUME_NAME_REGEX,
} from "../model/types";
import { getUserVolumesAction } from "../api/volume-actions";

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
  const [mode, setMode]: ["existing" | "new", Dispatch<SetStateAction<"existing" | "new">>] = useState<"existing" | "new">("new");
  const [availableVolumes, setAvailableVolumes]: [VolumeItem[], Dispatch<SetStateAction<VolumeItem[]>>] = useState<VolumeItem[]>([]);
  const [selectedVolumeName, setSelectedVolumeName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");

  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [mountPath, setMountPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [subPath, setSubPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sizeGb, setSizeGb]: [number, Dispatch<SetStateAction<number>>] = useState<number>(5);
  const [accessMode, setAccessMode]: ["ReadWrite" | "ReadOnly", Dispatch<SetStateAction<"ReadWrite" | "ReadOnly">>] = useState<"ReadWrite" | "ReadOnly">("ReadWrite");
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  useEffect((): (() => void) => {
    if (!isOpen) return (): void => {};

    let active: boolean = true;
    getUserVolumesAction().then((vols: VolumeItem[]): void => {
      if (!active) return;
      setAvailableVolumes(vols);
      if (vols.length > 0 && !initialValues) {
        setMode("existing");
        setSelectedVolumeName(vols[0]?.name ?? "");
      }
    });

    if (initialValues) {
      setMode("new");
      setName(initialValues.name);
      setMountPath(initialValues.mount_path);
      setSubPath(initialValues.sub_path ?? "");
      setSizeGb(initialValues.size_gb);
      setAccessMode(initialValues.access_mode ?? "ReadWrite");
    }

    return (): void => {
      active = false;
    };
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

    const trimmedMount: string = mountPath.trim();
    const trimmedSubPath: string = subPath.trim();

    if (!MOUNT_PATH_REGEX.test(trimmedMount)) {
      setErrorMessage("Mount path must be an absolute path inside the container starting with / (e.g. /var/data).");
      return;
    }

    let finalName: string = "";
    let finalSize: number = 5;

    if (mode === "existing") {
      const chosenVolume: VolumeItem | undefined = availableVolumes.find((v: VolumeItem): boolean => v.name === selectedVolumeName);
      if (!chosenVolume) {
        setErrorMessage("Please select an existing volume.");
        return;
      }
      finalName = chosenVolume.name;
      finalSize = chosenVolume.size_gb;
    } else {
      finalName = name.trim();
      finalSize = sizeGb;

      if (!VOLUME_NAME_REGEX.test(finalName)) {
        setErrorMessage("Volume name must be 2–32 lowercase letters, numbers, or hyphens (e.g. data-storage).");
        return;
      }

      if (!Number.isInteger(finalSize) || finalSize < 1) {
        setErrorMessage("Volume capacity must be a positive integer in GiB.");
        return;
      }
    }

    const payload: AttachVolumeInput = {
      name: finalName,
      mount_path: trimmedMount,
      ...(trimmedSubPath ? { sub_path: trimmedSubPath } : {}),
      size_gb: finalSize,
      access_mode: accessMode,
    };

    onSubmitVolume(payload);
    resetForm();
    onClose();
  }

  const chosenVolume: VolumeItem | undefined = availableVolumes.find((v: VolumeItem): boolean => v.name === selectedVolumeName);

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
        <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4">
          <div>
            <h2 id="attach-volume-title" className="text-base font-semibold text-foreground">
              Attach persistent storage volume
            </h2>
            <p className="mt-1 text-xs text-muted-text">
              Mount an Azure File Share directory into this container for durable state.
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

        {/* Segmented Control */}
        <div className="mt-4 flex justify-center">
          <div className="inline-flex rounded-lg border border-surface-border bg-background p-0.5 text-xs">
            <button
              type="button"
              onClick={(): void => setMode("existing")}
              className={`rounded-md px-4 py-1.5 font-medium transition-colors ${
                mode === "existing" ? "bg-accent text-white shadow-sm" : "text-muted-text hover:text-foreground"
              }`}
            >
              Attach Existing Volume
            </button>
            <button
              type="button"
              onClick={(): void => setMode("new")}
              className={`rounded-md px-4 py-1.5 font-medium transition-colors ${
                mode === "new" ? "bg-accent text-white shadow-sm" : "text-muted-text hover:text-foreground"
              }`}
            >
              Create New Volume
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === "existing" ? (
            <div>
              <label className={LABEL_CLASS} htmlFor="existing-volume-select">
                Select Volume
              </label>
              {availableVolumes.length === 0 ? (
                <p className="mt-2 text-xs text-amber-300">
                  No existing storage volumes found. Switch to &quot;Create New Volume&quot;.
                </p>
              ) : (
                <>
                  <select
                    id="existing-volume-select"
                    className={INPUT_CLASS}
                    value={selectedVolumeName}
                    onChange={(e: ChangeEvent<HTMLSelectElement>): void => setSelectedVolumeName(e.target.value)}
                    required
                  >
                    {availableVolumes.map((vol: VolumeItem): JSX.Element => (
                      <option key={vol.id} value={vol.name}>
                        {vol.name} ({vol.size_gb} GiB, {vol.region})
                      </option>
                    ))}
                  </select>
                  {chosenVolume && (
                    <p className="mt-1.5 text-[11px] text-muted-text">
                      Capacity: <span className="font-semibold text-foreground">{chosenVolume.size_gb} GiB</span> • Region:{" "}
                      <span className="font-semibold text-foreground">{chosenVolume.region}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
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
                  placeholder="e.g. data-storage"
                  value={name}
                  onChange={(e: ChangeEvent<HTMLInputElement>): void => setName(e.target.value.toLowerCase())}
                  autoComplete="off"
                />
                <span className="mt-1 block text-[11px] text-muted-text">
                  2–32 lowercase letters, numbers, or hyphens.
                </span>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="volume-size-gb">
                  Capacity (GiB)
                </label>
                <input
                  id="volume-size-gb"
                  className={INPUT_CLASS}
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={sizeGb}
                  onChange={(e: ChangeEvent<HTMLInputElement>): void => setSizeGb(Number(e.target.value))}
                />
              </div>
            </>
          )}

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-mount-path">
              Mount Path
            </label>
            <input
              id="volume-mount-path"
              className={INPUT_CLASS}
              type="text"
              required
              placeholder="e.g. /var/data"
              value={mountPath}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setMountPath(e.target.value)}
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">
              Absolute path inside the container where files will be accessed.
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="volume-access-mode">
                Access Mode
              </label>
              <select
                id="volume-access-mode"
                className={INPUT_CLASS}
                value={accessMode}
                onChange={(e: ChangeEvent<HTMLSelectElement>): void =>
                  setAccessMode(e.target.value as "ReadWrite" | "ReadOnly")
                }
              >
                <option value="ReadWrite">ReadWrite (Read/Write)</option>
                <option value="ReadOnly">ReadOnly (Read only)</option>
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="volume-sub-path">
                Subpath <span className="font-normal text-muted-dark">(optional)</span>
              </label>
              <input
                id="volume-sub-path"
                className={INPUT_CLASS}
                type="text"
                placeholder="e.g. uploads"
                value={subPath}
                onChange={(e: ChangeEvent<HTMLInputElement>): void => setSubPath(e.target.value)}
                autoComplete="off"
              />
            </div>
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
            <Button type="submit" variant="primary" size="sm" isDisabled={mode === "existing" && availableVolumes.length === 0}>
              Attach Volume
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
