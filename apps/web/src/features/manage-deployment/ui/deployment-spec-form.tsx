"use client";

import { Button, Description, FieldError, Form, Label, Modal, NumberField } from "@heroui/react";
import { useRouter } from "next/navigation";
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
import { getDeploymentResourceUpdate } from "../api/get-deployment-resource-update";
import {
  computeConfigurationsEqual, configurationFitsPlan, isResourceUpdateActive, resourceUpdateFailureMessage,
  type DeploymentEditContext, type UpdateDeploymentSpecResult, type ResourceUpdate,
} from "../model/deployment-spec";
import { clearResourceUpdateSession, readResourceUpdateSession, resourceUpdateRequestFingerprint, saveResourceUpdateSession, type ResourceUpdateSession } from "./resource-update-session";

interface DeploymentSpecFormProps {
  readonly deploymentId: string;
  readonly baseline: ComputeConfiguration;
  readonly configurationVersion: string | null;
  readonly appliedConfigurationAvailable: boolean;
  readonly initialOperation: ResourceUpdate | null;
  readonly baselineChanged: boolean;
  readonly reloadUnavailableReason: string | null;
  readonly onReload: () => void;
  readonly onCancel: () => void;
}

interface TrackedResourceUpdate {
  readonly operation_id: string;
  readonly status: ResourceUpdate["status"];
  readonly requested: ComputeConfiguration;
  readonly no_op: boolean | null;
  readonly error_code: string | null;
}

function trackedUpdate(operation: ResourceUpdate): TrackedResourceUpdate {
  return { operation_id: operation.operation_id, status: operation.status, requested: operation.requested,
    no_op: operation.no_op, error_code: operation.error_code };
}

function operationMessage(operation: TrackedResourceUpdate): string {
  switch (operation.status) {
    case "PENDING": return "Your change has been accepted and is waiting to be applied. Current resources remain unchanged until verification completes.";
    case "APPLYING": return "Your requested resources are being applied. You can close this dialog and check progress again later.";
    case "RECONCILING": return "Azure has not confirmed the final outcome yet. The backend is checking the existing operation; do not submit another change.";
    case "SUCCEEDED": return operation.no_op ? "The current resources already match your request. The backend verified the configuration." : "The backend verified your resource change. Current deployment values are being refreshed.";
    case "FAILED": return resourceUpdateFailureMessage(operation.error_code);
  }
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
  deploymentId, baseline, configurationVersion, appliedConfigurationAvailable, initialOperation, baselineChanged, reloadUnavailableReason, onReload, onCancel,
}: DeploymentSpecFormProps): JSX.Element {
  const [draft, setDraft]: [ComputeConfiguration, Dispatch<SetStateAction<ComputeConfiguration>>] = useState<ComputeConfiguration>(baseline);
  const [context, setContext]: [EditContextState, Dispatch<SetStateAction<EditContextState>>] = useState<EditContextState>({ kind: "loading" });
  const [contextAttempt, setContextAttempt]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [feedback, setFeedback]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [operation, setOperation]: [TrackedResourceUpdate | null, Dispatch<SetStateAction<TrackedResourceUpdate | null>>] = useState<TrackedResourceUpdate | null>(isResourceUpdateActive(initialOperation) && initialOperation ? trackedUpdate(initialOperation) : null);
  const [uncertain, setUncertain]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [pollIssue, setPollIssue]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const requestRef: RefObject<ResourceUpdateSession | null> = useRef<ResourceUpdateSession | null>(null);
  const mountedRef: RefObject<boolean> = useRef<boolean>(true);
  const router: ReturnType<typeof useRouter> = useRouter();
  const submittingRef: RefObject<boolean> = useRef<boolean>(false);
  const feedbackRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const errors: ComputeConfigurationErrors = validateComputeConfiguration(draft);
  const valid: boolean = Object.keys(errors).length === 0;
  const changed: boolean = !computeConfigurationsEqual(baseline, draft);
  const fitsPlan: boolean = context.kind === "ready" && configurationFitsPlan(draft, context.plans);
  const activeOperation: boolean = operation !== null && (operation.status === "PENDING" || operation.status === "APPLYING" || operation.status === "RECONCILING");
  const editLocked: boolean = pending || activeOperation || uncertain || operation !== null;
  const canSubmit: boolean = !pending && operation === null && (uncertain || (changed && valid && fitsPlan && !baselineChanged && !reloadUnavailableReason && configurationVersion !== null && appliedConfigurationAvailable));
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

  useEffect((): (() => void) => {
    mountedRef.current = true;
    const saved: ResourceUpdateSession | null = readResourceUpdateSession(deploymentId);
    if (isResourceUpdateActive(initialOperation) && initialOperation) {
      setOperation(trackedUpdate(initialOperation));
      setDraft(initialOperation.requested);
      requestRef.current = saved?.operationId === initialOperation.operation_id ? saved : null;
    } else if (saved) {
      requestRef.current = saved;
      setDraft(saved.configuration);
      if (saved.operationId) {
        setOperation(initialOperation?.operation_id === saved.operationId ? trackedUpdate(initialOperation) : {
          operation_id: saved.operationId, status: "PENDING", requested: saved.configuration, no_op: null, error_code: null,
        });
        if (initialOperation?.operation_id === saved.operationId && !isResourceUpdateActive(initialOperation)) {
          clearResourceUpdateSession(deploymentId);
          requestRef.current = null;
          if (initialOperation.status === "SUCCEEDED") router.refresh();
        }
      } else {
        setUncertain(true);
        setFeedback("The previous submission could not be confirmed. Retry the same request to recover its receipt; your retry will reuse the original key.");
      }
    }
    return (): void => { mountedRef.current = false; };
    // The editor owns a snapshot for this session; refreshed props must not replace its draft.
  }, [deploymentId]);

  useEffect((): (() => void) | undefined => {
    if (!operation || operation.status === "SUCCEEDED" || operation.status === "FAILED") return;
    let active: boolean = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts: number = 0;
    const operationId: string = operation.operation_id;
    const deadline: number = Date.now() + 5 * 60_000;
    setPollIssue(null);
    async function poll(): Promise<void> {
      try {
        const result: Awaited<ReturnType<typeof getDeploymentResourceUpdate>> = await getDeploymentResourceUpdate(deploymentId, operationId);
        if (!active) return;
        if (result.kind === "error") {
          setPollIssue(`${result.message} The accepted operation is still tracked. Retry checking its status.`);
          return;
        }
        const current: ResourceUpdate = result.operation;
        setOperation(trackedUpdate(current));
        if (current.status === "SUCCEEDED" || current.status === "FAILED") {
          clearResourceUpdateSession(deploymentId);
          requestRef.current = null;
          if (current.status === "SUCCEEDED") router.refresh();
          return;
        }
        attempts += 1;
        if (Date.now() >= deadline) {
          setPollIssue("The update is still in progress. You can close this dialog or check again; the backend will continue processing it.");
          return;
        }
        timer = setTimeout((): void => { void poll(); }, Math.min(5_000, 1_500 + attempts * 250));
      } catch {
        if (active) setPollIssue("The update status could not be loaded. The accepted operation remains tracked; retry checking its status.");
      }
    }
    void poll();
    return (): void => { active = false; if (timer) clearTimeout(timer); };
  }, [deploymentId, operation?.operation_id, pollAttempt, router]);

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
    setRefreshRequired(false);
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
      const prior: ResourceUpdateSession | null = requestRef.current;
      const request: ResourceUpdateSession = uncertain && prior ? prior : {
        key: prior && resourceUpdateRequestFingerprint(prior.version, prior.configuration) === resourceUpdateRequestFingerprint(configurationVersion!, draft)
          ? prior.key : crypto.randomUUID(),
        version: configurationVersion!, configuration: { ...draft }, operationId: null,
      };
      requestRef.current = request;
      saveResourceUpdateSession(deploymentId, request);
      const result: UpdateDeploymentSpecResult = await updateDeploymentSpec(deploymentId, request.configuration, request.version, request.key);
      if (result.kind === "accepted") {
        const accepted: ResourceUpdateSession = { ...request, operationId: result.operation.operation_id };
        requestRef.current = accepted;
        saveResourceUpdateSession(deploymentId, accepted);
        if (!mountedRef.current) return;
        setUncertain(false);
        setOperation({ operation_id: result.operation.operation_id, status: result.operation.status,
          requested: result.operation.requested, no_op: null, error_code: null });
      } else if (result.outcomeUnknown || uncertain) {
        if (!mountedRef.current) return;
        setUncertain(true);
        setFeedback(result.message);
      } else {
        clearResourceUpdateSession(deploymentId);
        requestRef.current = null;
        if (!mountedRef.current) return;
        setUncertain(false);
        setRefreshRequired(result.status === 412 || result.status === 428 || result.status === 422);
        setFeedback(result.message);
      }
    } catch {
      if (mountedRef.current) {
        setUncertain(true);
        setFeedback("The submission outcome could not be confirmed. Retry the same request to recover its receipt; another change will not be sent.");
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) {
        setPending(false);
        requestAnimationFrame((): void => feedbackRef.current?.focus());
      }
    }
  }

  return (
    <Form className="mt-5 flex min-h-0 flex-col" onSubmit={submit} validationBehavior="aria" aria-label="Edit deployment resources" aria-busy={pending}>
      <Modal.Body className="space-y-5 text-foreground">
        <div className="rounded-lg border border-accent/25 bg-accent-subtle px-3 py-2.5 text-xs leading-5 text-foreground">
          <p className="font-medium">Review changes</p>
          <p className="text-muted-text">Save to apply these resources to the existing image. The backend verifies the change before the deployment's current values are refreshed.</p>
        </div>

        {operation && (
          <div role="status" aria-live="polite" className={`rounded-lg border p-3 text-xs leading-5 ${operation.status === "SUCCEEDED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : operation.status === "FAILED" ? "border-danger/30 bg-danger/10 text-danger" : "border-accent/25 bg-accent-subtle text-foreground"}`}>
            <p className="font-medium">{operation.status === "PENDING" ? "Queued" : operation.status === "APPLYING" ? "Applying resources" : operation.status === "RECONCILING" ? "Verifying outcome" : operation.status === "SUCCEEDED" ? "Resources verified" : "Resource update failed"}</p>
            <p className="mt-1">{operationMessage(operation)}</p>
            {(operation.status === "SUCCEEDED" || operation.status === "FAILED") && <Button type="button" variant="secondary" size="sm" className="mt-2" onPress={(): void => { router.refresh(); onCancel(); }}>View current configuration</Button>}
          </div>
        )}
        {pollIssue && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200"><p>{pollIssue}</p><Button type="button" variant="secondary" size="sm" className="mt-2" onPress={(): void => setPollAttempt((current: number): number => current + 1)}>Check status again</Button></div>}
        {!appliedConfigurationAvailable && <p className="text-xs text-muted-text">Current applied resources could not be verified. The fields show this operation's requested values while its status is checked.</p>}

        {baselineChanged && !operation && !uncertain && (
          <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
            <p>The deployment changed while you were editing. Reload its current settings before saving.</p>
            {reloadUnavailableReason ? <p className="mt-1">{reloadUnavailableReason}</p> : (
              <Button type="button" variant="secondary" size="sm" className="mt-2" onPress={onReload}>Reload current settings</Button>
            )}
          </div>
        )}

        {baselineHasDrift && appliedConfigurationAvailable && (
          <p className="text-xs leading-5 text-amber-200">
            Current memory differs from the supported ratio of 2 GiB per vCPU. Choose a CPU allocation to set the requested memory. The comparison below keeps the original values.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField name="max_vcpu" value={draft.max_vcpu} onChange={(value: number): void => updateField("max_vcpu", value)} minValue={0.25} step={0.25} formatOptions={{ maximumFractionDigits: 2 }} isRequired isInvalid={Boolean(errors.max_vcpu)} isDisabled={editLocked} variant="secondary">
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
                <Button type="button" variant="ghost" size="sm" className="mt-1" isDisabled={editLocked} onPress={(): void => updateField("max_vcpu", draft.max_vcpu)}>
                  Use {formatValue(draft.max_vcpu * 2, "GiB")}
                </Button>
              </div>
            )}
          </div>

          <NumberField name="min_scaling" value={draft.min_scaling} onChange={(value: number): void => updateField("min_scaling", value)} minValue={0} step={1} isRequired isInvalid={Boolean(errors.min_scaling)} isDisabled={editLocked} variant="secondary">
            <Label className="text-xs font-medium text-foreground">Minimum replicas</Label>
            <NumberField.Group className="mt-1 border border-surface-border bg-background/60">
              <NumberField.DecrementButton aria-label="Decrease minimum replicas" />
              <NumberField.Input className="min-w-0 font-mono" />
              <NumberField.IncrementButton aria-label="Increase minimum replicas" />
            </NumberField.Group>
            <Description className="text-[11px] text-muted-text">Use 0 to scale down when idle.</Description>
            <FieldError className="text-xs text-danger">{errors.min_scaling}</FieldError>
          </NumberField>

          <NumberField name="max_scaling" value={draft.max_scaling} onChange={(value: number): void => updateField("max_scaling", value)} minValue={1} step={1} isRequired isInvalid={Boolean(errors.max_scaling)} isDisabled={editLocked} variant="secondary">
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

        {changed && appliedConfigurationAvailable && (
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

        {feedback && <div ref={feedbackRef} tabIndex={-1} role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200 outline-none focus-visible:ring-2 focus-visible:ring-accent"><p>{feedback}</p>{refreshRequired && <Button type="button" variant="secondary" size="sm" className="mt-2" onPress={(): void => { router.refresh(); setRefreshRequired(false); }}>Refresh configuration</Button>}</div>}
      </Modal.Body>
      <Modal.Footer className="shrink-0 flex-wrap border-t border-surface-border pt-4">
        <Button type="button" variant="ghost" size="sm" className="mr-auto" isDisabled={!changed || editLocked} onPress={reset}>Reset</Button>
        <Button type="button" variant="tertiary" size="sm" onPress={onCancel}>{operation || uncertain || pending ? "Close" : "Cancel"}</Button>
        <Button type="submit" variant="primary" size="sm" isDisabled={!canSubmit} isPending={pending}>{pending ? "Submitting…" : uncertain ? "Retry same request" : activeOperation ? "Update in progress" : "Save changes"}</Button>
      </Modal.Footer>
    </Form>
  );
}
