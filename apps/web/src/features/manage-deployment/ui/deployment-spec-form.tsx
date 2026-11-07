"use client";

import { Button, Description, FieldError, Form, Label, Modal, NumberField } from "@heroui/react";
import {
  useEffect, useRef, useState,
  type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction,
} from "react";
import {
  validateComputeConfiguration,
  type ComputeConfiguration,
  type ComputeConfigurationErrors,
} from "@/entities/deployment";
import type { Plan } from "@/entities/plan";
import { getDeploymentEditContext } from "../api/get-deployment-edit-context";
import { updateDeploymentSpec } from "../api/update-deployment-spec";
import {
  computeConfigurationsEqual, configurationFitsPlan,
  type DeploymentEditContext, type UpdateDeploymentSpecResult,
} from "../model/deployment-spec";

interface DeploymentSpecFormProps {
  readonly deploymentId: string;
  readonly baseline: ComputeConfiguration;
  readonly baselineChanged: boolean;
  readonly reloadUnavailableReason: string | null;
  readonly onReload: () => void;
  readonly onCancel: () => void;
}

type EditContextState = DeploymentEditContext | { readonly kind: "loading" };

interface ComputeField {
  readonly key: keyof ComputeConfiguration;
  readonly label: string;
  readonly unit: string;
}

const COMPUTE_FIELDS: readonly ComputeField[] = [
  { key: "max_vcpu", label: "CPU per replica", unit: "vCPU" },
  { key: "max_memory", label: "Memory per replica", unit: "GiB" },
  { key: "min_scaling", label: "Minimum replicas", unit: "" },
  { key: "max_scaling", label: "Maximum replicas", unit: "" },
];

function formatValue(value: number, unit: string): string {
  return Number.isFinite(value) ? `${value}${unit ? ` ${unit}` : ""}` : "—";
}

export function DeploymentSpecForm({
  deploymentId, baseline, baselineChanged, reloadUnavailableReason, onReload, onCancel,
}: DeploymentSpecFormProps): JSX.Element {
  const [draft, setDraft]: [ComputeConfiguration, Dispatch<SetStateAction<ComputeConfiguration>>] = useState<ComputeConfiguration>(baseline);
  const [context, setContext]: [EditContextState, Dispatch<SetStateAction<EditContextState>>] = useState<EditContextState>({ kind: "loading" });
  const [contextAttempt, setContextAttempt]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [feedback, setFeedback]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const submittingRef: RefObject<boolean> = useRef<boolean>(false);
  const feedbackRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const errors: ComputeConfigurationErrors = validateComputeConfiguration(draft);
  const valid: boolean = Object.keys(errors).length === 0;
  const changed: boolean = !computeConfigurationsEqual(baseline, draft);
  const fitsPlan: boolean = context.kind === "ready" && configurationFitsPlan(draft, context.plans);
  const canSubmit: boolean = changed && valid && fitsPlan && !baselineChanged && !pending;
  const baselineHasDrift: boolean = baseline.max_memory !== baseline.max_vcpu * 2;
  const changedFields: readonly ComputeField[] = COMPUTE_FIELDS.filter((field: ComputeField): boolean => baseline[field.key] !== draft[field.key]);

  useEffect((): (() => void) => {
    let active: boolean = true;
    getDeploymentEditContext().then((result: DeploymentEditContext): void => {
      if (active) setContext(result);
    }).catch((): void => {
      if (active) setContext({ kind: "unavailable" });
    });
    return (): void => { active = false; };
  }, [contextAttempt]);

  function updateField(field: "max_vcpu" | "min_scaling" | "max_scaling", value: number): void {
    setFeedback(null);
    setDraft((current: ComputeConfiguration): ComputeConfiguration => ({
      ...current,
      [field]: value,
      ...(field === "max_vcpu" ? { max_memory: value * 2 } : {}),
    }));
  }

  function reset(): void {
    setDraft(baseline);
    setFeedback(null);
  }

  function retryContext(): void {
    setContext({ kind: "loading" });
    setContextAttempt((current: number): number => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid) {
      event.currentTarget.querySelector<HTMLInputElement>("input[aria-invalid='true']")?.focus();
      return;
    }
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result: UpdateDeploymentSpecResult = await updateDeploymentSpec(deploymentId, draft);
      setFeedback(result.message);
    } catch {
      setFeedback("Resource changes could not be submitted. Your draft is still available.");
    } finally {
      submittingRef.current = false;
      setPending(false);
      requestAnimationFrame((): void => feedbackRef.current?.focus());
    }
  }

  return (
    <Form className="mt-5 flex min-h-0 flex-col" onSubmit={submit} validationBehavior="aria" aria-label="Edit deployment resources" aria-busy={pending}>
      <Modal.Body className="space-y-5 text-foreground">
        <div className="rounded-lg border border-accent/25 bg-accent-subtle px-3 py-2.5 text-xs leading-5 text-foreground">
          <p className="font-medium">Review changes</p>
          <p className="text-muted-text">Saving resource changes is not available yet. You can edit and compare settings here; your deployment will keep its current configuration.</p>
        </div>

        {baselineChanged && (
          <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
            <p>The deployment changed while you were editing. Reload its current settings before saving.</p>
            {reloadUnavailableReason ? <p className="mt-1">{reloadUnavailableReason}</p> : (
              <Button type="button" variant="secondary" size="sm" className="mt-2" onPress={onReload}>Reload current settings</Button>
            )}
          </div>
        )}

        {baselineHasDrift && (
          <p className="text-xs leading-5 text-amber-200">
            Current memory differs from the supported ratio of 2 GiB per vCPU. Choose a CPU allocation to set the requested memory. The comparison below keeps the original values.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField name="max_vcpu" value={draft.max_vcpu} onChange={(value: number): void => updateField("max_vcpu", value)} minValue={0.25} step={0.25} formatOptions={{ maximumFractionDigits: 2 }} isRequired isInvalid={Boolean(errors.max_vcpu)} isDisabled={pending} variant="secondary">
            <Label className="text-xs font-medium text-foreground">CPU per replica</Label>
            <NumberField.Group className="mt-1 border border-surface-border bg-background/60">
              <NumberField.DecrementButton aria-label="Decrease CPU" />
              <NumberField.Input className="min-w-0 font-mono" />
              <NumberField.IncrementButton aria-label="Increase CPU" />
            </NumberField.Group>
            <Description className="text-[11px] text-muted-text">vCPU, in steps of 0.25</Description>
            <FieldError className="text-xs text-danger">{errors.max_vcpu}</FieldError>
          </NumberField>

          <div>
            <p id="requested-memory-label" className="text-xs font-medium text-foreground">Memory per replica</p>
            <output aria-labelledby="requested-memory-label" aria-live="polite" className="mt-2 flex h-10 items-center rounded-lg border border-surface-border bg-background/60 px-3 font-mono text-sm">
              {formatValue(draft.max_memory, "GiB")}
            </output>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-text">Selecting CPU sets memory to twice its value.</p>
            {errors.max_memory && !errors.max_vcpu && (
              <div className="mt-1 text-xs text-danger">
                <p>{errors.max_memory}</p>
                <Button type="button" variant="ghost" size="sm" className="mt-1" isDisabled={pending} onPress={(): void => updateField("max_vcpu", draft.max_vcpu)}>
                  Use {formatValue(draft.max_vcpu * 2, "GiB")}
                </Button>
              </div>
            )}
          </div>

          <NumberField name="min_scaling" value={draft.min_scaling} onChange={(value: number): void => updateField("min_scaling", value)} minValue={0} step={1} isRequired isInvalid={Boolean(errors.min_scaling)} isDisabled={pending} variant="secondary">
            <Label className="text-xs font-medium text-foreground">Minimum replicas</Label>
            <NumberField.Group className="mt-1 border border-surface-border bg-background/60">
              <NumberField.DecrementButton aria-label="Decrease minimum replicas" />
              <NumberField.Input className="min-w-0 font-mono" />
              <NumberField.IncrementButton aria-label="Increase minimum replicas" />
            </NumberField.Group>
            <Description className="text-[11px] text-muted-text">Use 0 to scale down when idle.</Description>
            <FieldError className="text-xs text-danger">{errors.min_scaling}</FieldError>
          </NumberField>

          <NumberField name="max_scaling" value={draft.max_scaling} onChange={(value: number): void => updateField("max_scaling", value)} minValue={1} step={1} isRequired isInvalid={Boolean(errors.max_scaling)} isDisabled={pending} variant="secondary">
            <Label className="text-xs font-medium text-foreground">Maximum replicas</Label>
            <NumberField.Group className="mt-1 border border-surface-border bg-background/60">
              <NumberField.DecrementButton aria-label="Decrease maximum replicas" />
              <NumberField.Input className="min-w-0 font-mono" />
              <NumberField.IncrementButton aria-label="Increase maximum replicas" />
            </NumberField.Group>
            <Description className="text-[11px] text-muted-text">At least 1, and no less than the minimum.</Description>
            <FieldError className="text-xs text-danger">{errors.max_scaling}</FieldError>
          </NumberField>
        </div>

        <section aria-label="Plan limits" className="rounded-lg border border-surface-border bg-background/40 p-3 text-xs leading-5">
          <p className="font-medium text-foreground">Your plan limits</p>
          {context.kind === "loading" && <p role="status" className="mt-1 text-muted-text">Checking your active plans…</p>}
          {context.kind === "ready" && (
            <>
              <ul className="mt-2 space-y-2">
                {context.plans.map((plan: Plan): JSX.Element => (
                  <li key={plan.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                    <span className="text-foreground">{plan.name}</span>
                    <span className="font-mono text-[11px] text-muted-text">{plan.vcpu} vCPU · {plan.memory} GiB · {plan.max_replicas} replicas</span>
                  </li>
                ))}
              </ul>
              {valid && !fitsPlan && <p role="alert" className="mt-2 text-amber-200">CPU, memory, and maximum replicas must fit together within one active plan.</p>}
            </>
          )}
          {context.kind === "no-plan" && <p className="mt-1 text-muted-text">An active plan is required to change resources. <a href="/plans" className="text-foreground underline underline-offset-4">View plans</a></p>}
          {context.kind === "forbidden" && <p className="mt-1 text-muted-text">Your plan access could not be verified. <a href="/login" className="text-foreground underline underline-offset-4">Sign in again</a> to continue.</p>}
          {context.kind === "unavailable" && (
            <div className="mt-1">
              <p role="alert" className="text-muted-text">Plan limits could not be loaded. Your draft is still available.</p>
              <Button type="button" variant="ghost" size="sm" className="mt-2" onPress={retryContext}>Retry loading limits</Button>
            </div>
          )}
        </section>

        {changed && (
          <div className="overflow-hidden rounded-lg border border-surface-border">
            <table className="w-full text-left text-xs">
              <caption className="border-b border-surface-border bg-background/40 px-3 py-2 text-left font-medium text-foreground">Proposed changes</caption>
              <thead className="text-[11px] text-muted-text">
                <tr><th scope="col" className="px-3 py-2 font-normal">Resource</th><th scope="col" className="px-3 py-2 font-normal">Current</th><th scope="col" className="px-3 py-2 font-normal">Requested</th></tr>
              </thead>
              <tbody>
                {changedFields.map((field: ComputeField): JSX.Element => (
                  <tr key={field.key}>
                    <th scope="row" className="px-3 py-2 font-normal text-muted-text">{field.label}</th>
                    <td className="px-3 py-2 font-mono text-muted-text">{formatValue(baseline[field.key], field.unit)}</td>
                    <td className="px-3 py-2 font-mono text-foreground">{formatValue(draft[field.key], field.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {feedback && <div ref={feedbackRef} tabIndex={-1} role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200 outline-none focus-visible:ring-2 focus-visible:ring-accent">{feedback}</div>}
      </Modal.Body>
      <Modal.Footer className="shrink-0 flex-wrap border-t border-surface-border pt-4">
        <Button type="button" variant="ghost" size="sm" className="mr-auto" isDisabled={!changed || pending} onPress={reset}>Reset</Button>
        <Button type="button" variant="tertiary" size="sm" onPress={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" isDisabled={!canSubmit} isPending={pending}>{pending ? "Submitting…" : "Save changes"}</Button>
      </Modal.Footer>
    </Form>
  );
}
