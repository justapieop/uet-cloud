"use client";

import { Button } from "@heroui/react";
import { useState, useTransition, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { attachVolumeAction } from "../api/actions";
import {
  type AttachVolumeInput,
  type VolumeActionResult,
  MOUNT_PATH_REGEX,
  VOLUME_NAME_REGEX,
} from "../model/types";

interface AttachVolumeModalProps {
  readonly deploymentId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const INPUT_CLASS: string =
  "mt-1.5 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dark focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";
const LABEL_CLASS: string = "block text-xs font-medium text-foreground";

export function AttachVolumeModal({ deploymentId, isOpen, onClose }: AttachVolumeModalProps): JSX.Element | null {
  const router: AppRouterInstance = useRouter();
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [mountPath, setMountPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [subPath, setSubPath]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sizeGb, setSizeGb]: [number, Dispatch<SetStateAction<number>>] = useState<number>(5);
  const [accessMode, setAccessMode]: ["ReadWrite" | "ReadOnly", Dispatch<SetStateAction<"ReadWrite" | "ReadOnly">>] = useState<"ReadWrite" | "ReadOnly">("ReadWrite");
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();

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
    if (pending) return;
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
      setErrorMessage("Tên volume phải gồm 2–32 ký tự chữ thường, số hoặc gạch nối (ví dụ: data-storage).");
      return;
    }

    if (!MOUNT_PATH_REGEX.test(trimmedMount)) {
      setErrorMessage("Mount path phải là đường dẫn tuyệt đối bắt đầu bằng / (ví dụ: /var/data).");
      return;
    }

    if (!Number.isInteger(sizeGb) || sizeGb < 1) {
      setErrorMessage("Dung lượng phải là số nguyên dương tính theo GiB.");
      return;
    }

    const payload: AttachVolumeInput = {
      name: trimmedName,
      mount_path: trimmedMount,
      ...(trimmedSubPath ? { sub_path: trimmedSubPath } : {}),
      size_gb: sizeGb,
      access_mode: accessMode,
    };

    startTransition(async (): Promise<void> => {
      const result: VolumeActionResult = await attachVolumeAction(deploymentId, payload);
      if (!result.success) {
        setErrorMessage(result.error ?? "Không thể gắn volume. Vui lòng thử lại.");
      } else {
        resetForm();
        onClose();
        router.refresh();
      }
    });
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
              Gắn Persistent Volume mới
            </h2>
            <p className="mt-1 text-xs text-muted-text">
              Tạo Azure File Share và mount trực tiếp vào container của deployment này.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className="rounded-lg p-1 text-muted-text hover:bg-surface-hover hover:text-foreground"
            aria-label="Đóng dialog"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className={LABEL_CLASS} htmlFor="volume-name">
              Tên volume
            </label>
            <input
              id="volume-name"
              className={INPUT_CLASS}
              type="text"
              required
              disabled={pending}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setName(e.target.value)}
              placeholder="data-storage"
              pattern="[a-z][a-z0-9-]{0,30}[a-z0-9]"
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">2–32 chữ thường, số hoặc gạch ngang.</span>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-mount-path">
              Mount path trong container
            </label>
            <input
              id="volume-mount-path"
              className={INPUT_CLASS}
              type="text"
              required
              disabled={pending}
              value={mountPath}
              onChange={(e: ChangeEvent<HTMLInputElement>): void => setMountPath(e.target.value)}
              placeholder="/var/data"
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] text-muted-text">Đường dẫn tuyệt đối trong container (bắt đầu bằng /).</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="volume-size">
                Dung lượng (GiB)
              </label>
              <input
                id="volume-size"
                className={INPUT_CLASS}
                type="number"
                required
                min="1"
                step="1"
                disabled={pending}
                value={sizeGb}
                onChange={(e: ChangeEvent<HTMLInputElement>): void => setSizeGb(Number(e.target.value))}
              />
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="volume-access-mode">
                Chế độ truy cập
              </label>
              <select
                id="volume-access-mode"
                className={INPUT_CLASS}
                disabled={pending}
                value={accessMode}
                onChange={(e: ChangeEvent<HTMLSelectElement>): void =>
                  setAccessMode(e.target.value as "ReadWrite" | "ReadOnly")
                }
              >
                <option value="ReadWrite">ReadWrite (Đọc & Ghi)</option>
                <option value="ReadOnly">ReadOnly (Chỉ đọc)</option>
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="volume-sub-path">
              Thư mục con (subpath) <span className="font-normal text-muted-dark">(tuỳ chọn)</span>
            </label>
            <input
              id="volume-sub-path"
              className={INPUT_CLASS}
              type="text"
              disabled={pending}
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
            <Button type="button" variant="ghost" size="sm" isDisabled={pending} onPress={handleClose}>
              Huỷ
            </Button>
            <Button type="submit" variant="primary" size="sm" isPending={pending} isDisabled={pending}>
              {pending ? "Đang gắn volume…" : "Gắn volume"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
