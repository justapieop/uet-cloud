"use client";

import { Button } from "@heroui/react";
import { useState, useTransition, type Dispatch, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { detachVolumeAction } from "../api/actions";
import type { VolumeActionResult } from "../model/types";

interface DetachVolumeDialogProps {
  readonly deploymentId: string;
  readonly volumeName: string | null;
  readonly mode: "detach" | "delete" | null;
  readonly onClose: () => void;
}

export function DetachVolumeDialog({
  deploymentId,
  volumeName,
  mode,
  onClose,
}: DetachVolumeDialogProps): JSX.Element | null {
  const router: AppRouterInstance = useRouter();
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();

  if (!volumeName || !mode) return null;

  const isDelete: boolean = mode === "delete";

  function handleClose(): void {
    if (pending) return;
    setErrorMessage(null);
    onClose();
  }

  function handleConfirm(): void {
    if (!volumeName) return;
    setErrorMessage(null);
    startTransition(async (): Promise<void> => {
      const result: VolumeActionResult = await detachVolumeAction(deploymentId, volumeName, isDelete);
      if (!result.success) {
        setErrorMessage(result.error ?? "Không thể thực hiện thao tác. Vui lòng thử lại.");
      } else {
        onClose();
        router.refresh();
      }
    });
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
        onClick={handleClose}
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
              {isDelete ? "Xoá vĩnh viễn volume & dữ liệu?" : "Gỡ volume khỏi container?"}
            </h2>
            <p id="detach-volume-description" className="mt-2 text-xs leading-5 text-muted-text">
              {isDelete ? (
                <>
                  Volume <span className="font-mono font-medium text-foreground">{volumeName}</span> sẽ bị gỡ khỏi
                  container và <strong className="text-red-400">xoá vĩnh viễn toàn bộ dữ liệu</strong> trên Azure Storage
                  file share. Thao tác này <strong className="text-red-400">không thể khôi phục</strong>.
                </>
              ) : (
                <>
                  Volume <span className="font-mono font-medium text-foreground">{volumeName}</span> sẽ được gỡ khỏi
                  container app. Toàn bộ file và dữ liệu vẫn được <strong className="text-foreground">giữ nguyên an toàn</strong> trên
                  Azure Storage.
                </>
              )}
            </p>
          </div>
        </div>

        {errorMessage && (
          <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-surface-border pt-4">
          <Button type="button" variant="ghost" size="sm" isDisabled={pending} onPress={handleClose}>
            Huỷ bỏ
          </Button>
          <Button
            type="button"
            variant={isDelete ? "danger" : "secondary"}
            size="sm"
            isPending={pending}
            isDisabled={pending}
            onPress={handleConfirm}
          >
            {pending ? "Đang xử lý…" : isDelete ? "Xóa vĩnh viễn" : "Gỡ volume"}
          </Button>
        </div>
      </div>
    </div>
  );
}
