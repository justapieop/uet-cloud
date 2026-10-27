"use client";

import { useEffect, useState, useTransition, type Dispatch, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Deployment } from "@/entities/deployment";
import { startDeploymentAction, stopDeploymentAction, type LifecycleActionResult } from "../api/actions";

interface DeploymentActionButtonProps {
  readonly id: string;
  readonly status: Deployment["status"];
}

export function DeploymentActionButton({ id, status }: DeploymentActionButtonProps): JSX.Element {
  const router: AppRouterInstance = useRouter();
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  const isStarting: boolean = status === "STARTING";
  const isStopping: boolean = status === "STOPPING";
  const isTransient: boolean = isStarting || isStopping;

  useEffect((): (() => void) => {
    if (!isTransient) {
      return (): void => {};
    }
    const timer: NodeJS.Timeout = setInterval((): void => {
      router.refresh();
    }, 3000);
    return (): void => {
      clearInterval(timer);
    };
  }, [isTransient, router]);

  if (status !== "RUNNING" && status !== "STOPPED" && !isTransient) {
    return <span className="text-xs text-muted-dark">—</span>;
  }

  const isRunning: boolean = status === "RUNNING";
  const isDisabled: boolean = pending || isTransient;

  function handleAction(): void {
    setErrorMessage(null);
    startTransition(async (): Promise<void> => {
      const result: LifecycleActionResult = isRunning
        ? await stopDeploymentAction(id)
        : await startDeploymentAction(id);

      if (!result.success && result.error) {
        setErrorMessage(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const baseClass: string = "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
  const stopClass: string = "border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/20";
  const startClass: string = "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/20";
  const startingClass: string = "border border-blue-500/30 bg-blue-500/10 text-blue-300";
  const stoppingClass: string = "border border-amber-500/30 bg-amber-500/10 text-amber-300";

  const activeClass: string = isStarting
    ? startingClass
    : isStopping
    ? stoppingClass
    : isRunning
    ? stopClass
    : startClass;

  const label: string = isStarting
    ? "Starting…"
    : isStopping
    ? "Stopping…"
    : pending
    ? isRunning
      ? "Stopping…"
      : "Starting…"
    : isRunning
    ? "Stop"
    : "Start";

  const dotColor: string = isStarting
    ? "bg-blue-400"
    : isStopping || isRunning
    ? "bg-amber-400"
    : "bg-emerald-400";

  const isPulsing: boolean = pending || isTransient;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isDisabled}
        onClick={handleAction}
        className={`${baseClass} ${activeClass}`}
        aria-label={isRunning ? "Stop deployment" : isStarting ? "Deployment starting" : isStopping ? "Deployment stopping" : "Start deployment"}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${isPulsing ? "animate-ping bg-current" : dotColor}`}
        />
        <span>{label}</span>
      </button>
      {errorMessage && (
        <span role="alert" className="text-[10px] text-red-300">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
