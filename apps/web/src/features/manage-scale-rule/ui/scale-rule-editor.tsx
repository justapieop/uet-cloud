"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction, type TransitionStartFunction } from "react";
import type { Deployment } from "@/entities/deployment";
import { deleteScaleRule, saveScaleRule, setScaleRuleEnabled } from "../api/actions";
import type { ScaleRule, ScaleRuleResult } from "../model/types";

const FIELD: string = "mt-2 h-10 w-full rounded-lg border border-surface-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent";
const BUTTON: string = "rounded-lg border border-surface-border px-4 py-2 text-xs font-medium transition-colors hover:bg-surface-hover disabled:opacity-50";
const REASONS: Readonly<Record<string, string>> = {
  configuration_updated: "Waiting for a complete monitoring window",
  cooldown: "Waiting for the cooldown to finish",
  monitoring_or_capacity_unavailable: "Waiting for reliable monitoring data and a healthy application",
  incomplete_metrics: "Waiting for monitoring data from every replica",
  incomplete_or_stale_metrics: "Waiting for fresh monitoring data",
  invalid_metrics: "Monitoring data could not be validated",
  warming_up: "Waiting for the application and monitoring to settle",
  replicas_not_stable: "Waiting for the replica count to settle",
  min_replicas: "At the minimum replica count",
  max_replicas: "At the maximum replica count",
  threshold_not_sustained: "CPU has not stayed above or below a threshold for the full window",
  sustained_high_cpu: "Added capacity after sustained high CPU",
  sustained_low_cpu: "Reduced capacity after sustained low CPU",
  quota_exceeded: "The deployment exceeds current plan limits",
  subscription_unavailable_or_ineligible: "An active plan could not be verified",
  deployment_changed: "The deployment changed during evaluation; waiting for the next check",
  scaling_failed_or_unconfirmed: "Scaling could not be confirmed; check deployment status",
};

export function ScaleRuleEditor({ deployment, rule }: { readonly deployment: Deployment; readonly rule: ScaleRule | null }): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const busy: RefObject<boolean> = useRef(false);
  const deleting: boolean = ["DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED"].includes(deployment.status);
  const editable: boolean = !deleting && deployment.status !== "SCALING" && Boolean(deployment.resource_id);

  function run(task: () => Promise<ScaleRuleResult>): void {
    if (busy.current) return;
    busy.current = true; setError(null);
    startTransition(async (): Promise<void> => {
      try {
        const result: ScaleRuleResult = await task();
        if (!result.success) setError(result.error ?? "Unable to save scale rule.");
        else router.refresh();
      } catch { setError("The change could not be confirmed. Refresh before retrying."); }
      finally { busy.current = false; }
    });
  }

  return (
    <form aria-label="Configure CPU auto scaling" aria-busy={pending} onSubmit={(event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault(); const form: FormData = new FormData(event.currentTarget);
      run((): Promise<ScaleRuleResult> => saveScaleRule(deployment.id, rule !== null, form));
    }} className="space-y-5">
      <p className="text-xs leading-5 text-muted-text">CPU scaling needs at least one running replica. CPU percentages are relative to the vCPU allocated to each replica. Pausing or deleting the rule keeps the current capacity.</p>
      {!editable && <p role="status" className="text-xs text-amber-300">Scale rule changes are unavailable while this deployment is scaling, being deleted, or awaiting provisioning.</p>}
      <fieldset disabled={pending || !editable} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium">Scale out above CPU %<input className={FIELD} name="scale_out_threshold" type="number" required min="0" max="100" step="0.1" defaultValue={rule?.scale_out_threshold ?? 80} /></label>
        <label className="text-xs font-medium">Scale in below CPU %<input className={FIELD} name="scale_in_threshold" type="number" required min="0" max="100" step="0.1" defaultValue={rule?.scale_in_threshold ?? 20} /></label>
        <label className="text-xs font-medium">Minimum replicas<input className={FIELD} name="min_replicas" type="number" required min="1" max="1000" step="1" defaultValue={rule?.min_replicas ?? Math.max(1, deployment.min_scaling ?? 1)} /></label>
        <label className="text-xs font-medium">Maximum replicas<input className={FIELD} name="max_replicas" type="number" required min="1" max="1000" step="1" defaultValue={rule?.max_replicas ?? Math.max(1, deployment.max_scaling ?? 1)} /></label>
        <label className="text-xs font-medium">Evaluation window (seconds)<input className={FIELD} name="evaluation_window_seconds" type="number" required min="120" max="1800" step="60" defaultValue={rule?.evaluation_window_seconds ?? 300} /></label>
        <label className="text-xs font-medium">Cooldown (seconds)<input className={FIELD} name="cooldown_seconds" type="number" required min="60" max="86400" step="1" defaultValue={rule?.cooldown_seconds ?? 300} /></label>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? false} className="size-4 accent-accent" />Enable automatic CPU scaling</label>
      </fieldset>
      {rule && <p className="text-xs leading-5 text-muted-text" role="status">Last evaluation: {rule.last_evaluated_at ? new Date(rule.last_evaluated_at).toISOString().replace("T", " ").replace(".000Z", " UTC") : "Waiting"}. {REASONS[rule.last_reason] ?? "Waiting for the next evaluation"}.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || !editable} className={`${BUTTON} bg-accent text-white`}>{pending ? "Saving…" : rule ? "Save rule" : "Create rule"}</button>
        {rule && <button type="button" disabled={pending || !editable} className={BUTTON} onClick={(): void => run((): Promise<ScaleRuleResult> => setScaleRuleEnabled(deployment.id, !rule.enabled))}>{rule.enabled ? "Pause" : "Enable"}</button>}
        {rule && <button type="button" disabled={pending || !editable} className={`${BUTTON} text-red-300`} onClick={(): void => run((): Promise<ScaleRuleResult> => deleteScaleRule(deployment.id))}>Delete rule</button>}
        <button type="button" disabled={pending} className={BUTTON} onClick={(): void => router.refresh()}>Refresh status</button>
      </div>
    </form>
  );
}
