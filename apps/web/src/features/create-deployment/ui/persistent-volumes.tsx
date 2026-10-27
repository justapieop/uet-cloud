"use client";

import { Button } from "@heroui/react";
import { useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";

type PersistentVolumesProps = {
  readonly inputClass: string;
  readonly labelClass: string;
  readonly disabled: boolean;
};

type VolumeRow = {
  readonly id: number;
};

export function PersistentVolumes({ inputClass, labelClass, disabled }: PersistentVolumesProps): JSX.Element {
  const [rows, setRows]: [VolumeRow[], Dispatch<SetStateAction<VolumeRow[]>>] = useState<VolumeRow[]>([]);
  const nextId: RefObject<number> = useRef<number>(0);

  function addVolume(): void {
    const id: number = nextId.current++;
    setRows((current: VolumeRow[]): VolumeRow[] => (current.length < 5 ? [...current, { id }] : current));
    requestAnimationFrame((): void => {
      document.getElementById(`volume-name-${id}`)?.focus();
    });
  }

  function removeVolume(id: number): void {
    setRows((current: VolumeRow[]): VolumeRow[] => current.filter((row: VolumeRow): boolean => row.id !== id));
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
        {rows.map(({ id }: VolumeRow, index: number): JSX.Element => (
          <fieldset key={id} className="rounded-lg border border-surface-border p-4" aria-describedby="persistent-volumes-help">
            <legend className="px-1 text-xs font-medium">Volume {index + 1}</legend>
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
                  min="1"
                  step="1"
                  defaultValue="5"
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

              <div className="flex items-center sm:col-span-2 sm:justify-end">
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
            </div>
          </fieldset>
        ))}
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
