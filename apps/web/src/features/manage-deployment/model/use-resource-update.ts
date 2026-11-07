"use client";

import { startTransition, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import type { ComputeConfiguration } from "@/entities/deployment";
import { getDeploymentResourceUpdate } from "../api/get-deployment-resource-update";
import { updateDeploymentSpec } from "../api/update-deployment-spec";
import { isResourceUpdateActive, resourceUpdateFailureMessage, type ResourceUpdate, type UpdateDeploymentSpecResult } from "./deployment-spec";
import { clearResourceUpdateSession, readResourceUpdateSession, saveResourceUpdateSession, type ResourceUpdateSession } from "./resource-update-session";

interface ResourceUpdateProgress {
  readonly operation_id: string;
  readonly status: ResourceUpdate["status"];
  readonly requested: ComputeConfiguration;
  readonly no_op: boolean | null;
  readonly error_code: string | null;
}

export interface ResourceUpdateController {
  readonly pending: boolean;
  readonly active: boolean;
  readonly uncertain: boolean;
  readonly status: ResourceUpdate["status"] | null;
  readonly message: string | null;
  readonly pollIssue: string | null;
  readonly refreshRequired: boolean;
  readonly draft: ComputeConfiguration | null;
  readonly submit: (configuration: ComputeConfiguration, version: string) => void;
  readonly retry: () => void;
  readonly checkStatus: () => void;
  readonly refresh: () => void;
  readonly beginEditing: () => void;
}

function progressMessage(operation: ResourceUpdateProgress): string {
  switch (operation.status) {
    case "PENDING": return "Resource update queued. Current resources remain unchanged until verification completes.";
    case "APPLYING": return "Applying resources. You can continue using this page.";
    case "RECONCILING": return "Azure is still confirming the outcome. The existing update is being checked.";
    case "SUCCEEDED": return operation.no_op ? "Current resources already match your request." : "Resource changes verified. Current values have been refreshed.";
    case "FAILED": return resourceUpdateFailureMessage(operation.error_code);
  }
}

/** Lives with the card, so closing the editor never cancels receipt recovery or polling. */
export function useResourceUpdate(deploymentId: string, initialOperation: ResourceUpdate | null): ResourceUpdateController {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [operation, setOperation]: [ResourceUpdateProgress | null, Dispatch<SetStateAction<ResourceUpdateProgress | null>>] = useState<ResourceUpdateProgress | null>(isResourceUpdateActive(initialOperation) ? initialOperation : null);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [uncertain, setUncertain]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [feedback, setFeedback]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pollIssue, setPollIssue]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [refreshRequired, setRefreshRequired]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [lastRequest, setLastRequest]: [ResourceUpdateSession | null, Dispatch<SetStateAction<ResourceUpdateSession | null>>] = useState<ResourceUpdateSession | null>(null);
  const requestRef: RefObject<ResourceUpdateSession | null> = useRef<ResourceUpdateSession | null>(null);
  const submittingRef: RefObject<boolean> = useRef<boolean>(false);
  const mountedRef: RefObject<boolean> = useRef<boolean>(true);
  const terminalRef: RefObject<string | null> = useRef<string | null>(null);
  const active: boolean = isResourceUpdateActive(operation);

  useEffect((): (() => void) => {
    mountedRef.current = true;
    const saved: ResourceUpdateSession | null = readResourceUpdateSession(deploymentId);
    if (saved && !saved.operationId) {
      // A matching latest operation alone does not prove which idempotency key created it.
      // Recover the original receipt before replacing an unconfirmed request.
      requestRef.current = saved;
      setLastRequest(saved);
      setOperation(null);
      setUncertain(true);
      setFeedback("The previous submission could not be confirmed. Retry the same request to recover its result safely.");
    } else if (isResourceUpdateActive(initialOperation) && initialOperation) {
      setOperation(initialOperation);
      requestRef.current = saved?.operationId === initialOperation.operation_id ? saved : null;
    } else if (saved) {
      requestRef.current = saved;
      setLastRequest(saved);
      if (saved.operationId) {
        if (initialOperation?.operation_id === saved.operationId) {
          setOperation(initialOperation);
          terminalRef.current = saved.operationId;
          clearResourceUpdateSession(deploymentId);
          requestRef.current = null;
          if (initialOperation.status === "SUCCEEDED") setLastRequest(null);
          router.refresh();
        } else {
          setOperation({ operation_id: saved.operationId, status: "PENDING", requested: saved.configuration, no_op: null, error_code: null });
        }
      }
    }
    return (): void => { mountedRef.current = false; };
    // Restore once per deployment. Refreshed route data must not replace an in-flight request.
  }, [deploymentId]);

  useEffect((): void => {
    if (!pending && !uncertain && requestRef.current?.operationId !== null && initialOperation && isResourceUpdateActive(initialOperation) && terminalRef.current !== initialOperation.operation_id) {
      setOperation((current: ResourceUpdateProgress | null): ResourceUpdateProgress => current?.operation_id === initialOperation.operation_id ? current : initialOperation);
    }
  }, [initialOperation, pending, uncertain]);

  useEffect((): (() => void) | undefined => {
    if (!operation || !active) return;
    let watching: boolean = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts: number = 0;
    const operationId: string = operation.operation_id;
    const deadline: number = Date.now() + 5 * 60_000;
    setPollIssue(null);
    async function poll(): Promise<void> {
      try {
        const result: Awaited<ReturnType<typeof getDeploymentResourceUpdate>> = await getDeploymentResourceUpdate(deploymentId, operationId);
        if (!watching) return;
        if (result.kind === "error") {
          setPollIssue(`${result.message} The accepted update remains tracked.`);
          return;
        }
        const current: ResourceUpdate = result.operation;
        setOperation(current);
        if (!isResourceUpdateActive(current)) {
          terminalRef.current = current.operation_id;
          clearResourceUpdateSession(deploymentId);
          requestRef.current = null;
          if (current.status === "SUCCEEDED") setLastRequest(null);
          router.refresh();
          return;
        }
        attempts += 1;
        if (Date.now() >= deadline) {
          setPollIssue("The update is still in progress. The backend will continue processing it.");
          return;
        }
        timer = setTimeout((): void => { void poll(); }, Math.min(5_000, 1_500 + attempts * 250));
      } catch {
        if (watching) setPollIssue("The update status could not be loaded. The accepted update remains tracked.");
      }
    }
    startTransition((): void => { void poll(); });
    return (): void => { watching = false; if (timer) clearTimeout(timer); };
  }, [deploymentId, operation?.operation_id, active, pollAttempt, router]);

  function send(request: ResourceUpdateSession, wasUncertain: boolean): void {
    if (submittingRef.current) return;
    submittingRef.current = true;
    requestRef.current = request;
    saveResourceUpdateSession(deploymentId, request);
    setLastRequest(request);
    setPending(true);
    setOperation(null);
    setFeedback(null);
    setRefreshRequired(false);
    startTransition(async (): Promise<void> => {
      try {
        const result: UpdateDeploymentSpecResult = await updateDeploymentSpec(deploymentId, request.configuration, request.version, request.key);
        if (result.kind === "accepted") {
          const accepted: ResourceUpdateSession = { ...request, operationId: result.operation.operation_id };
          requestRef.current = accepted;
          saveResourceUpdateSession(deploymentId, accepted);
          if (!mountedRef.current) return;
          setUncertain(false);
          setOperation({ ...result.operation, no_op: null, error_code: null });
        } else if (result.outcomeUnknown || wasUncertain) {
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
          setFeedback("The submission could not be confirmed. Retry the same request to recover its result safely.");
        }
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    });
  }

  return {
    pending, active, uncertain, status: operation?.status ?? null,
    message: feedback ?? (operation ? progressMessage(operation) : null), pollIssue, refreshRequired,
    draft: lastRequest?.configuration ?? (operation?.status === "FAILED" ? operation.requested : null),
    submit: (configuration: ComputeConfiguration, version: string): void => {
      if (submittingRef.current || active || uncertain) return;
      send({ key: crypto.randomUUID(), version, configuration: { ...configuration }, operationId: null }, false);
    },
    retry: (): void => { if (requestRef.current && !active) send(requestRef.current, true); },
    checkStatus: (): void => setPollAttempt((current: number): number => current + 1),
    refresh: (): void => { router.refresh(); setRefreshRequired(false); },
    beginEditing: (): void => { setOperation(null); setFeedback(null); setPollIssue(null); },
  };
}
