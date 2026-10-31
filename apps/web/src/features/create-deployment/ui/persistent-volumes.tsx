"use client";

import { Button } from "@heroui/react";
import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";
import type { VolumeItem } from "@/entities/volume";
import { getUserVolumesAction } from "@/features/manage-volume";

type PersistentVolumesProps = {
  readonly inputClass: string;
  readonly labelClass: string;
  readonly disabled: boolean;
};

type VolumeRow = {
  readonly id: number;
  mode: "existing" | "new";
  selectedExistingVolume: string;
};

export function PersistentVolumes({ inputClass, labelClass, disabled }: PersistentVolumesProps): JSX.Element {
  const [rows, setRows]: [VolumeRow[], Dispatch<SetStateAction<VolumeRow[]>>] = useState<VolumeRow[]>([]);
  const [availableVolumes, setAvailableVolumes]: [VolumeItem[], Dispatch<SetStateAction<VolumeItem[]>>] = useState<VolumeItem[]>([]);
  const nextId: RefObject<number> = useRef<number>(0);

  useEffect((): (() => void) => {
    let active: boolean = true;
    getUserVolumesAction().then((vols: VolumeItem[]): void => {
      if (active) setAvailableVolumes(vols);
    });
    return (): void => {
      active = false;
    };
  }, []);

  function addVolume(): void {
    const id: number = nextId.current++;
    const defaultMode: "existing" | "new" = availableVolumes.length > 0 ? "existing" : "new";
    const defaultVolume: string = availableVolumes[0]?.name ?? "";

    setRows((current: VolumeRow[]): VolumeRow[] =>
      current.length < 5 ? [...current, { id, mode: defaultMode, selectedExistingVolume: defaultVolume }] : current,
    );
  }

  function removeVolume(id: number): void {
    setRows((current: VolumeRow[]): VolumeRow[] => current.filter((row: VolumeRow): boolean => row.id !== id));
  }

  function toggleMode(id: number, mode: "existing" | "new"): void {
    setRows((current: VolumeRow[]): VolumeRow[] =>
      current.map((row: VolumeRow): VolumeRow => {
        if (row.id !== id) return row;
        return {
          ...row,
          mode,
          selectedExistingVolume: mode === "existing" ? (availableVolumes[0]?.name ?? "") : "",
        };
      }),
    );
  }

  function handleSelectExistingVolume(id: number, volumeName: string): void {
    setRows((current: VolumeRow[]): VolumeRow[] =>
      current.map((row: VolumeRow): VolumeRow => (row.id === id ? { ...row, selectedExistingVolume: volumeName } : row)),
    );
  }

  return (
    <div className="mt-6 border-t border-surface-border pt-6">
      <h3 className="text-sm font-medium">
        Persistent storage volumes <span className="font-normal text-muted-dark">(optional)</span>
      </h3>
      <p id="persistent-volumes-help" className="mt-2 text-xs leading-5 text-muted-text">
        Attach Azure File Shares for persistent container state. Add up to 5 volumes with distinct names and mount paths.
      </p>

      <div className="mt-4 space-y-4">
        {rows.map((row: VolumeRow, index: number): JSX.Element => {
          const id: number = row.id;
          const mode: "existing" | "new" = row.mode;
          const selectedExistingVolume: string = row.selectedExistingVolume;
          const chosenVolume: VolumeItem | undefined = availableVolumes.find((v: VolumeItem): boolean => v.name === selectedExistingVolume);

          return (
            <fieldset key={id} className="rounded-lg border border-surface-border p-4" aria-describedby="persistent-volumes-help">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-surface-border pb-3">
                <legend className="px-1 text-xs font-medium">Volume {index + 1}</legend>

                {/* Segmented Control */}
                <div className="inline-flex rounded-lg border border-surface-border bg-background p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={(): void => toggleMode(id, "existing")}
                    disabled={disabled}
                    className={`rounded-md px-3 py-1 font-medium transition-colors ${
                      mode === "existing"
                        ? "bg-accent text-white shadow-sm"
                        : "text-muted-text hover:text-foreground"
                    }`}
                  >
                    Attach Existing
                  </button>
                  <button
                    type="button"
                    onClick={(): void => toggleMode(id, "new")}
                    disabled={disabled}
                    className={`rounded-md px-3 py-1 font-medium transition-colors ${
                      mode === "new"
                        ? "bg-accent text-white shadow-sm"
                        : "text-muted-text hover:text-foreground"
                    }`}
                  >
                    Create New
                  </button>
                </div>
              </div>

              {mode === "existing" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor={`existing-volume-${id}`}>
                      Select existing volume
                    </label>
                    {availableVolumes.length === 0 ? (
                      <p className="mt-2 text-xs text-amber-300">
                        No standalone volumes available. Switch to &quot;Create New&quot; to define a volume.
                      </p>
                    ) : (
                      <>
                        <select
                          id={`existing-volume-${id}`}
                          className={inputClass}
                          value={selectedExistingVolume}
                          onChange={(e: ChangeEvent<HTMLSelectElement>): void => handleSelectExistingVolume(id, e.target.value)}
                          disabled={disabled}
                          required
                        >
                          {availableVolumes.map((vol: VolumeItem): JSX.Element => (
                            <option key={vol.id} value={vol.name}>
                              {vol.name} ({vol.size_gb} GiB, {vol.region})
                            </option>
                          ))}
                        </select>
                        <input type="hidden" name="volume_name" value={selectedExistingVolume} />
                        <input type="hidden" name="volume_size_gb" value={chosenVolume ? chosenVolume.size_gb : 32} />
                      </>
                    )}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-mount-path-${id}`}>
                      Mount path
                    </label>
                    <input
                      id={`volume-mount-path-${id}`}
                      className={inputClass}
                      name="volume_mount_path"
                      type="text"
                      required
                      placeholder="/var/data"
                      autoComplete="off"
                    />
                    <span className="mt-1 block text-[11px] text-muted-text">Absolute path in container (must start with /).</span>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-access-mode-${id}`}>
                      Access mode
                    </label>
                    <select
                      id={`volume-access-mode-${id}`}
                      className={inputClass}
                      name="volume_access_mode"
                      defaultValue="ReadWrite"
                    >
                      <option value="ReadWrite">ReadWrite (Read/Write)</option>
                      <option value="ReadOnly">ReadOnly (Read only)</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-sub-path-${id}`}>
                      Subpath in file share <span className="font-normal text-muted-dark">(optional)</span>
                    </label>
                    <input
                      id={`volume-sub-path-${id}`}
                      className={inputClass}
                      name="volume_sub_path"
                      type="text"
                      placeholder="e.g. data/uploads"
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor={`volume-name-${id}`}>
                      Volume name
                    </label>
                    <input
                      id={`volume-name-${id}`}
                      className={inputClass}
                      name="volume_name"
                      type="text"
                      required
                      pattern="[a-z][a-z0-9-]{0,30}[a-z0-9]"
                      placeholder="data-storage"
                      autoComplete="off"
                    />
                    <span className="mt-1 block text-[11px] text-muted-text">2–32 lowercase letters, numbers, or hyphens.</span>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-mount-path-${id}`}>
                      Mount path
                    </label>
                    <input
                      id={`volume-mount-path-${id}`}
                      className={inputClass}
                      name="volume_mount_path"
                      type="text"
                      required
                      placeholder="/var/data"
                      autoComplete="off"
                    />
                    <span className="mt-1 block text-[11px] text-muted-text">Absolute path in container (must start with /).</span>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-size-gb-${id}`}>
                      Capacity (GiB)
                    </label>
                    <input
                      id={`volume-size-gb-${id}`}
                      className={inputClass}
                      name="volume_size_gb"
                      type="number"
                      required
                      min="32"
                      max="262144"
                      step="1"
                      defaultValue="32"
                    />
                  </div>

                  <div>
                    <label className={labelClass} htmlFor={`volume-access-mode-${id}`}>
                      Access mode
                    </label>
                    <select
                      id={`volume-access-mode-${id}`}
                      className={inputClass}
                      name="volume_access_mode"
                      defaultValue="ReadWrite"
                    >
                      <option value="ReadWrite">ReadWrite (Read/Write)</option>
                      <option value="ReadOnly">ReadOnly (Read only)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className={labelClass} htmlFor={`volume-sub-path-${id}`}>
                      Subpath in file share <span className="font-normal text-muted-dark">(optional)</span>
                    </label>
                    <input
                      id={`volume-sub-path-${id}`}
                      className={inputClass}
                      name="volume_sub_path"
                      type="text"
                      placeholder="e.g. data/uploads"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-end border-t border-surface-border/50 pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  isDisabled={disabled}
                  aria-label={`Remove volume ${index + 1}`}
                  onPress={(): void => removeVolume(id)}
                >
                  Remove volume
                </Button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isDisabled={disabled || rows.length >= 5}
          onPress={addVolume}
        >
          Add persistent volume
        </Button>
        <span className="text-xs text-muted-text" role="status">
          {rows.length} of 5 volumes added
        </span>
      </div>
    </div>
  );
}
