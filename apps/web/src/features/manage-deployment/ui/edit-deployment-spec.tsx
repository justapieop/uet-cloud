"use client";

import { Button, Modal } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useId, useState, type Dispatch, type JSX, type SetStateAction } from "react";
import type { ComputeConfiguration, Deployment } from "@/entities/deployment";
import { getDeploymentComputeConfiguration, getDeploymentEditUnavailableReason, getDeploymentSpecFingerprint } from "../model/deployment-spec";
import { useResourceUpdate, type ResourceUpdateController } from "../model/use-resource-update";
import { DeploymentSpecForm } from "./deployment-spec-form";

interface EditDeploymentSpecProps {
  readonly deployment: Deployment;
}

interface EditorSession {
  readonly configuration: ComputeConfiguration;
  readonly draft: ComputeConfiguration | null;
  readonly fingerprint: string;
  readonly configurationVersion: string;
}

export function EditDeploymentSpec({ deployment }: EditDeploymentSpecProps): JSX.Element {
  return <DeploymentSpecEditor key={deployment.id} deployment={deployment} />;
}

function DeploymentSpecEditor({ deployment }: EditDeploymentSpecProps): JSX.Element {
  const [session, setSession]: [EditorSession | null, Dispatch<SetStateAction<EditorSession | null>>] = useState<EditorSession | null>(null);
  const reasonId: string = useId();
  const statusId: string = useId();
  const router: ReturnType<typeof useRouter> = useRouter();
  const update: ResourceUpdateController = useResourceUpdate(deployment.id, deployment.resource_update);
  const unavailableReason: string | null = getDeploymentEditUnavailableReason(deployment);
  const fingerprint: string = getDeploymentSpecFingerprint(deployment);
  const busy: boolean = update.pending || update.active;
  const label: string = update.pending ? "Submitting…" : update.active ? update.status === "RECONCILING" ? "Verifying…" : "Updating…" : update.uncertain ? "Retry update" : "Edit";

  function openCurrentConfiguration(preserveDraft: boolean = true): void {
    const configuration: ComputeConfiguration | null = getDeploymentComputeConfiguration(deployment);
    if (busy || update.uncertain || unavailableReason || !configuration || !deployment.configuration_version) return;
    update.beginEditing();
    setSession({ configuration, draft: preserveDraft ? update.draft : null, fingerprint, configurationVersion: deployment.configuration_version });
  }

  function submit(configuration: ComputeConfiguration): void {
    if (!session) return;
    const version: string = session.configurationVersion;
    setSession(null);
    update.submit(configuration, version);
  }

  return (
    <div className="flex max-w-64 flex-col items-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        isPending={busy}
        isDisabled={busy || (!update.uncertain && unavailableReason !== null)}
        aria-label={`${label === "Edit" ? "Edit resources and scaling" : label} for ${deployment.name}`}
        aria-describedby={update.message ? statusId : unavailableReason && !busy ? reasonId : undefined}
        onPress={(): void => { if (update.uncertain) update.retry(); else openCurrentConfiguration(); }}
      >
        {label}
      </Button>

      <Modal isOpen={session !== null} onOpenChange={(isOpen: boolean): void => { if (!isOpen) setSession(null); }}>
        <Modal.Backdrop>
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog className="border border-surface-border bg-surface sm:max-w-[600px]">
              <Modal.CloseTrigger />
              <Modal.Header className="pr-7">
                <Modal.Heading className="text-lg font-semibold text-foreground">Edit resources and scaling</Modal.Heading>
                <p className="mt-1 text-xs leading-5 text-muted-text"><span className="font-mono text-foreground">{deployment.name}</span>{" · "}Resources are allocated to each replica.</p>
              </Modal.Header>
              {session && (
                <DeploymentSpecForm
                  key={session.fingerprint}
                  baseline={session.configuration}
                  initialDraft={session.draft}
                  configurationVersion={session.configurationVersion}
                  baselineChanged={session.fingerprint !== fingerprint}
                  reloadUnavailableReason={unavailableReason}
                  onReload={(): void => openCurrentConfiguration(false)}
                  onCancel={(): void => setSession(null)}
                  onSubmit={submit}
                />
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {update.message && <p id={statusId} role="status" aria-live="polite" className={`text-right text-[11px] leading-4 ${update.status === "FAILED" ? "text-danger" : update.status === "SUCCEEDED" ? "text-emerald-300" : "text-muted-text"}`}>{update.message}</p>}
      {update.refreshRequired && <Button variant="ghost" size="sm" onPress={update.refresh}>Refresh configuration</Button>}
      {update.pollIssue && (
        <div role="alert" className="text-right text-[11px] leading-4 text-amber-200">
          <p>{update.pollIssue}</p>
          <Button variant="ghost" size="sm" className="mt-1" onPress={update.checkStatus}>Check status again</Button>
        </div>
      )}
      {unavailableReason && !busy && !update.uncertain && (
        <div className="text-right text-[11px] leading-4 text-muted-text">
          <p id={reasonId}>{unavailableReason}</p>
          {(!getDeploymentComputeConfiguration(deployment) || !deployment.configuration_version) && deployment.resource_id && deployment.status !== "STOPPED" && (
            <Button variant="ghost" size="sm" className="mt-1" onPress={(): void => router.refresh()}>Refresh configuration</Button>
          )}
        </div>
      )}
    </div>
  );
}
