"use client";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type RefObject, type Dispatch, type SetStateAction, type JSX } from "react";
import type { AdminResult } from "@/shared/api/admin-errors";
import { setCancellation } from "../api/set-cancellation";

export function CancellationControl({ userId, subscriptionId, scheduled }: { readonly userId: string; readonly subscriptionId: string; readonly scheduled: boolean }): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const key: RefObject<string | null> = useRef<string | null>(null);
  const busy: RefObject<boolean> = useRef(false);
  const [confirm, setConfirm]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [done, setDone]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  async function apply(): Promise<void> {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    if (!key.current) key.current = crypto.randomUUID();
    try {
      const result: AdminResult<string> = await setCancellation(userId, subscriptionId, !scheduled, key.current);
      if (result.error) setError(result.error);
      else { setDone(true); router.refresh(); }
    } catch { setError("The update could not be confirmed. Retry the same action."); }
    finally { busy.current = false; setPending(false); }
  }
  if (done) return <p role="status" className="text-sm text-emerald-300">Subscription updated.</p>;
  return <div className="space-y-3">
    {!confirm ? <Button variant={scheduled ? "secondary" : "danger-soft"} size="sm" onPress={(): void => setConfirm(true)}>{scheduled ? "Undo scheduled cancellation" : "Cancel at period end"}</Button> : <div className="space-y-3 rounded-lg border border-surface-border p-4"><p className="text-sm leading-6">{scheduled ? "Remove the scheduled cancellation? The current subscription will continue." : "Schedule cancellation at the end of the current period? This does not cancel immediately or issue a refund."}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant={scheduled ? "primary" : "danger"} isPending={pending} isDisabled={pending} onPress={(): void => { void apply(); }}>Confirm</Button><Button size="sm" variant="ghost" isDisabled={pending} onPress={(): void => setConfirm(false)}>Back</Button></div></div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </div>;
}
