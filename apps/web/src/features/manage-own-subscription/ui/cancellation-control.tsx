"use client";

import { Button } from "@heroui/react";
import { useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";
import { setMyCancellation } from "../api/set-my-cancellation";

interface CancellationControlProps {
  readonly subscriptionId: string;
  readonly scheduled: boolean;
}

type SetMyCancellationResult = Awaited<ReturnType<typeof setMyCancellation>>;

export function CancellationControl({ subscriptionId, scheduled }: CancellationControlProps): JSX.Element {
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
      const result: SetMyCancellationResult = await setMyCancellation(subscriptionId, !scheduled);
      if (result.kind === "demo-success") {
        setSuccessMessage(result.message);
        setConfirm(false);
      } else if (result.kind === "error") {
        setError(result.message);
      } else {
        setError("Demo actions are unavailable outside development.");
      }
    } catch {
      setError("The demo action could not be completed. No subscription change was made.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (successMessage !== null) {
    return <p role="status" className="text-sm leading-6 text-emerald-300">{successMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {!confirm ? (
        <Button
          variant={scheduled ? "secondary" : "danger-soft"}
          size="sm"
          isDisabled={pending}
          onPress={(): void => {
            setError(null);
            setConfirm(true);
          }}
        >
          {scheduled ? "Undo scheduled cancellation (demo)" : "Cancel at period end (demo)"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-surface-border p-4">
          <p className="text-sm leading-6">
            {scheduled
              ? "Preview removing the scheduled cancellation? This demo will not change your subscription."
              : "Preview scheduling cancellation at the end of this period? This demo will not change your subscription."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={scheduled ? "primary" : "danger"}
              isPending={pending}
              isDisabled={pending}
              onPress={(): void => {
                void apply();
              }}
            >
              Confirm demo
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
