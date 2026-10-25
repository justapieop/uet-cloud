"use client";

import { useState, useTransition, type Dispatch, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import type { Deployment } from "@/entities/deployment";
import { startDeploymentAction, stopDeploymentAction, type LifecycleActionResult } from "../api/actions";

interface DeploymentActionButtonProps {
  readonly id: string;
  readonly status: Deployment["status"];
}

export function DeploymentActionButton({ id, status }: DeploymentActionButtonProps): JSX.Element {
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  if (status !== "RUNNING" && status !== "STOPPED") {
    return <span className="text-xs text-muted-dark">—</span>;
  }

  const isRunning: boolean = status === "RUNNING";

  function handleAction(): void {
    setErrorMessage(null);
    startTransition(async (): Promise<void> => {
      const result: LifecycleActionResult = isRunning
        ? await stopDeploymentAction(id)
        : await startDeploymentAction(id);

      if (!result.success && result.error) {
        setErrorMessage(result.error);
      }
    });
  }

  const baseClass: string = "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
  const stopClass: string = "border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/20";
  const startClass: string = "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/20";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleAction}
        className={`${baseClass} ${isRunning ? stopClass : startClass}`}
        aria-label={isRunning ? "Stop deployment" : "Start deployment"}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${pending ? "animate-ping bg-current" : isRunning ? "bg-amber-400" : "bg-emerald-400"}`}
        />
        <span>
          {pending
            ? isRunning ? "Stopping…" : "Starting…"
            : isRunning ? "Stop" : "Start"}
        </span>
      </button>
      {errorMessage && (
        <span role="alert" className="text-[10px] text-red-300">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
