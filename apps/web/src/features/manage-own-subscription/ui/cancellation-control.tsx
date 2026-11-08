"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";
import { setMyCancellation } from "../api/set-my-cancellation";

interface CancellationControlProps {
  readonly subscriptionId: string;
  readonly scheduled: boolean;
  readonly cancelAt: number | null;
  readonly demo: boolean;
}

type SetMyCancellationResult = Awaited<ReturnType<typeof setMyCancellation>>;

function formatCancellationDate(timestamp: number | null): string {
  if (timestamp === null) return "At period end";

  const date: Date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date)} UTC`;
}


export function CancellationControl({ subscriptionId, scheduled, cancelAt, demo }: CancellationControlProps): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const key: RefObject<string | null> = useRef<string | null>(null);
  const [demoScheduled, setCurrentScheduled]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(scheduled);
  const currentScheduled: boolean = demo ? demoScheduled : scheduled;
  const busy: RefObject<boolean> = useRef<boolean>(false);
  const [confirm, setConfirm]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [successMessage, setSuccessMessage]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  async function apply(): Promise<void> {
    if (busy.current) return;

    busy.current = true;
    setPending(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result: SetMyCancellationResult = await setMyCancellation(subscriptionId, !currentScheduled, key.current ??= crypto.randomUUID());
      if (result.kind === "demo-success" || result.kind === "success") {
        setCurrentScheduled(!currentScheduled);
        key.current = null;
        if (result.kind === "success") router.refresh();
        setSuccessMessage(result.message);
        setConfirm(false);
      } else if (result.kind === "error") {
        setError(result.message);
      }
    } catch {
      setError("Could not verify the update. Retry to check the result.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-text">{currentScheduled ? `Cancellation scheduled: ${scheduled && cancelAt ? formatCancellationDate(cancelAt) : "end of the current period"}.` : "No period-end cancellation is scheduled."}</p>
      {demo && <p className="text-sm text-muted-text">Demo preview: {currentScheduled ? "cancellation scheduled" : "subscription continues"}. Changes reset when this page reloads.</p>}
      {successMessage !== null && <p role="status" className="text-sm leading-6 text-emerald-300">{successMessage}</p>}
      {!confirm ? (
        <Button
          variant={currentScheduled ? "secondary" : "danger-soft"}
          size="sm"
          isDisabled={pending}
          onPress={(): void => {
            setError(null);
            setConfirm(true);
          }}
        >
          {currentScheduled ? "Undo scheduled cancellation" : "Cancel at period end"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-surface-border p-4">
          <p className="text-sm leading-6">
            {currentScheduled
              ? (demo ? "Preview removing the scheduled cancellation? This changes demo data only." : "Remove the scheduled cancellation? Your subscription will continue.")
              : (demo ? "Preview cancellation at period end? This changes demo data only." : "Schedule cancellation at the end of this period? This does not cancel immediately or issue a refund.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={currentScheduled ? "primary" : "danger"}
              isPending={pending}
              isDisabled={pending}
              onPress={(): void => {
                void apply();
              }}
            >
              {demo ? "Confirm demo" : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={pending}
              onPress={(): void => setConfirm(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}
      {error !== null && <p role="alert" className="text-sm leading-6 text-red-300">{error}</p>}
    </div>
  );
}
