"use client";

import { AlertDialog, Button, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type JSX,
  type MutableRefObject,
  type SetStateAction,
  type TransitionStartFunction,
} from "react";
import type { Deployment } from "@/entities/deployment";
import { deleteDeploymentAction, type LifecycleActionResult } from "../api/actions";

interface DeleteDeploymentButtonProps {
  readonly id: string;
  readonly name: string;
  readonly status: Deployment["status"];
  readonly pollForCompletion?: boolean;
}

function isDeletionActive(status: Deployment["status"]): boolean {
  return status === "DELETE_PENDING" || status === "DELETING";
}

function canDeleteDeployment(status: Deployment["status"]): boolean {
  return status === "PENDING" || status === "RUNNING" || status === "STOPPED" ||
    status === "FAILED" || status === "DELETE_FAILED";
}

export function DeleteDeploymentButton({
  id,
  name,
  status,
  pollForCompletion = false,
}: DeleteDeploymentButtonProps): JSX.Element | null {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [isOpen, setIsOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [isPending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [errorMessage, setErrorMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const pollStartedAtRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const deletionActive: boolean = isDeletionActive(status);

  useEffect((): (() => void) | undefined => {
    if (!pollForCompletion || !deletionActive || pollTimedOut) {
      if (!deletionActive) pollStartedAtRef.current = null;
      return undefined;
    }

    if (pollStartedAtRef.current === null) {
      pollStartedAtRef.current = Date.now();
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      const startedAt: number | null = pollStartedAtRef.current;
      if (startedAt === null) {
        clearInterval(timer);
        return;
      }
      if (Date.now() - startedAt >= 300_000) {
        clearInterval(timer);
        setPollTimedOut(true);
        return;
      }
      if (!document.hidden && !isPending) {
        startTransition((): void => {
          router.refresh();
        });
      }
    }, 3_500);

    return (): void => clearInterval(timer);
  }, [deletionActive, isPending, pollForCompletion, pollTimedOut, router, startTransition]);

  if (status === "DELETED") return null;

  if (deletionActive) {
    return (
      <div className="flex flex-col items-start gap-2">
        <span role="status" className="whitespace-nowrap text-xs text-amber-300">
          {status === "DELETE_PENDING" ? "Deletion queued" : "Deleting…"}
        </span>
        {pollTimedOut && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isDisabled={isPending}
            onPress={(): void => {
              pollStartedAtRef.current = Date.now();
              setPollTimedOut(false);
              startTransition((): void => router.refresh());
            }}
          >
            Refresh status
          </Button>
        )}
      </div>
    );
  }

  if (!canDeleteDeployment(status)) return null;

  const isRetry: boolean = status === "DELETE_FAILED";
  const triggerLabel: string = isRetry ? "Retry" : "Delete";

  function handleConfirm(): void {
    setErrorMessage(null);
    startTransition(async (): Promise<void> => {
      const result: LifecycleActionResult = await deleteDeploymentAction(id);
      if (!result.success) {
        setErrorMessage(result.error ?? "Failed to delete deployment.");
        return;
      }

      setIsOpen(false);
      setPollTimedOut(false);
      pollStartedAtRef.current = null;
      toast.success(`Deletion of "${name}" was accepted.`);
      router.refresh();
    });
  }

  function handleOpenChange(nextIsOpen: boolean): void {
    if (isPending) return;
    setIsOpen(nextIsOpen);
    if (!nextIsOpen) setErrorMessage(null);
  }

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        aria-busy={isPending}
        aria-label={isRetry ? `Retry deletion of ${name}` : `Delete deployment ${name}`}
        className="inline-flex h-7 w-[68px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 font-mono text-[11px] font-medium text-red-300 transition-all hover:border-red-500/50 hover:bg-red-500/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        onClick={(): void => {
          setPollTimedOut(false);
          pollStartedAtRef.current = null;
          setIsOpen(true);
        }}
      >
        <span>{triggerLabel}</span>
      </button>

      <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[440px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                {isRetry ? "Retry deployment deletion?" : "Delete deployment?"}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                This permanently removes deployment <strong className="font-mono">{name}</strong>, its Azure Container App, and its environment storage links.
                The deletion runs in the background and cannot be undone.
              </p>
              {errorMessage && (
                <p role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                  {errorMessage}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" slot="close" variant="tertiary" isDisabled={isPending}>
                Cancel
              </Button>
              <Button type="button" variant="danger" isDisabled={isPending} onPress={handleConfirm}>
                {isPending ? "Submitting…" : isRetry ? "Retry deletion" : "Delete deployment"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
