"use client";

import { useRef, useState, useTransition, type Dispatch, type JSX, type RefObject, type SetStateAction, type TransitionStartFunction } from "react";
import { createCheckout, type CheckoutResult } from "../api/create-checkout";

export function SelectPlanButton({ planId }: { readonly planId: string }): JSX.Element {
  const requestKey: RefObject<string | null> = useRef<string | null>(null);
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();

  function selectPlan(): void {
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    const key: string = requestKey.current;
    setError(null);
    startTransition(async (): Promise<void> => {
      try {
        const result: CheckoutResult = await createCheckout(planId, key);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      } catch {
        setError("Checkout could not be reached. Please try again.");
      }
    });
  }

  return (
    <div>
      <button type="button" disabled={pending} onClick={selectPlan} className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60">
        {pending ? "Opening checkout…" : "Continue to checkout"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm leading-6 text-red-300">{error}</p>}
    </div>
  );
}