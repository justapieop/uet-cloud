"use client";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState, useRef, type Dispatch, type SetStateAction, type FormEvent, type ChangeEvent, type JSX, type RefObject } from "react";
import type { AdminPlan } from "@/entities/plan/admin";
import type { AdminResult } from "@/shared/api/admin-errors";
import { savePlan, deactivatePlan } from "../api/actions";

const FIELD: string = "mt-2 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent";

export function PlanEditor({ plan }: { readonly plan?: AdminPlan }): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [cpu, setCpu]: [string, Dispatch<SetStateAction<string>>] = useState(String(plan?.vcpu ?? 0.5));
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [result, setResult]: [AdminResult<string> | null, Dispatch<SetStateAction<AdminResult<string> | null>>] = useState<AdminResult<string> | null>(null);
  const [confirm, setConfirm]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const busy: RefObject<boolean> = useRef(false);

  async function run(task: () => Promise<AdminResult<string>>): Promise<void> {
    if (busy.current) return;
    busy.current = true; setPending(true); setResult(null);
    try {
      const response: AdminResult<string> = await task();
      setResult(response);
      if (response.data) { setConfirm(false); router.refresh(); }
    } catch { setResult({ error: "The request could not be confirmed. Refresh to check the plan before retrying." }); }
    finally { busy.current = false; setPending(false); }
  }

  return (
    <form aria-label={plan ? "Edit plan" : "Create plan"} aria-busy={pending} onSubmit={(event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); const form: FormData = new FormData(event.currentTarget); void run((): Promise<AdminResult<string>> => savePlan(form, plan?.id)); }} className="space-y-5">
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium">Plan ID<input name="id" required maxLength={255} readOnly={Boolean(plan)} defaultValue={plan?.id} placeholder="starter" className={FIELD} /></label>
        <label className="text-xs font-medium">Name<input name="name" required maxLength={255} defaultValue={plan?.name} placeholder="Starter" className={FIELD} /></label>
        <label className="text-xs font-medium">Catalog price<input name="price" required type="number" min="0" step="0.0001" defaultValue={plan?.price ?? 0} className={FIELD} /></label>
        <label className="text-xs font-medium">vCPU per replica<input name="vcpu" required type="number" min="0.25" step="0.25" value={cpu} onChange={(event: ChangeEvent<HTMLInputElement>): void => setCpu(event.target.value)} className={FIELD} /></label>
        <div className="text-xs font-medium">Memory per replica<output className="mt-2 flex h-10 items-center rounded-lg border border-surface-border px-3 font-mono text-sm text-muted-text">{cpu && Number.isFinite(Number(cpu)) ? Number(cpu) * 2 : "—"} GiB</output></div>
        <label className="text-xs font-medium">Deployment slots<input name="deployments" required type="number" min="1" step="1" defaultValue={plan?.deployments ?? 1} className={FIELD} /></label>
        <label className="text-xs font-medium">Maximum replicas<input name="max_replicas" required type="number" min="1" step="1" defaultValue={plan?.max_replicas ?? 1} className={FIELD} /></label>
        <label className="text-xs font-medium">Storage quota<input name="disk" required type="number" min="1" step="1" defaultValue={plan?.disk ?? 10} className={FIELD} /></label>
        <label className="text-xs font-medium">Stripe product ID<input name="stripe_product_id" maxLength={255} defaultValue={plan?.stripe_product_id ?? ""} placeholder="prod_… (optional)" className={FIELD} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="active" type="checkbox" defaultChecked={plan?.active ?? false} className="size-4 accent-accent" />Active plan</label>
      </fieldset>
      <p className="text-xs leading-5 text-muted-text">Catalog price is local metadata. Stripe controls checkout billing. Plan changes affect subsequent eligibility and quota checks; they do not modify running deployments.</p>
      {result && <p role={result.error ? "alert" : "status"} className={`rounded-lg border border-surface-border p-3 text-sm ${result.error ? "text-red-300" : "text-emerald-300"}`}>{result.error ?? result.data}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isDisabled={pending} isPending={pending} className="rounded-lg">{pending ? "Saving…" : plan ? "Save changes" : "Create plan"}</Button>
        {plan && <a href="/admin" className="px-2 text-sm text-muted-text hover:text-foreground">Close editor</a>}
        {plan?.active && <Button type="button" variant="danger-soft" isDisabled={pending} className="rounded-lg sm:ml-auto" onPress={(): void => setConfirm(true)}>Deactivate plan</Button>}
      </div>
      {confirm && plan && <div className="space-y-3 rounded-lg border border-red-400/20 bg-red-400/5 p-4"><p className="text-sm leading-6">Deactivate {plan.name}? This removes eligibility through this plan for future deployments, including existing subscribers. Stripe subscriptions remain unchanged.</p><div className="flex gap-3"><Button type="button" variant="danger" isDisabled={pending} onPress={(): void => { void run((): Promise<AdminResult<string>> => deactivatePlan(plan.id)); }}>Confirm deactivation</Button><Button type="button" variant="ghost" isDisabled={pending} onPress={(): void => setConfirm(false)}>Keep active</Button></div></div>}
    </form>
  );
}
