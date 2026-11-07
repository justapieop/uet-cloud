"use client";

import { Button, Modal } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useId, useState, type Dispatch, type JSX, type SetStateAction } from "react";
import type { ComputeConfiguration, Deployment } from "@/entities/deployment";
import {
  getDeploymentComputeConfiguration,
  getDeploymentEditUnavailableReason,
  getDeploymentSpecFingerprint,
} from "../model/deployment-spec";
import { DeploymentSpecForm } from "./deployment-spec-form";

interface EditDeploymentSpecProps {
  readonly deployment: Deployment;
}

interface EditorSession {
  readonly configuration: ComputeConfiguration;
  readonly fingerprint: string;
}

export function EditDeploymentSpec({ deployment }: EditDeploymentSpecProps): JSX.Element {
  const [session, setSession]: [EditorSession | null, Dispatch<SetStateAction<EditorSession | null>>] = useState<EditorSession | null>(null);
  const reasonId: string = useId();
  const router: ReturnType<typeof useRouter> = useRouter();
  const unavailableReason: string | null = getDeploymentEditUnavailableReason(deployment);
  const fingerprint: string = getDeploymentSpecFingerprint(deployment);

  function openCurrentConfiguration(): void {
    const configuration: ComputeConfiguration | null = getDeploymentComputeConfiguration(deployment);
    if (unavailableReason || !configuration) return;
    setSession({ configuration, fingerprint });
  }

  function handleOpenChange(isOpen: boolean): void {
    if (isOpen) openCurrentConfiguration();
    else setSession(null);
  }

  return (
    <div className="flex max-w-64 flex-col items-end gap-2">
      <Modal isOpen={session !== null} onOpenChange={handleOpenChange}>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={unavailableReason !== null}
          aria-label={`Edit resources and scaling for ${deployment.name}`}
          aria-describedby={unavailableReason ? reasonId : undefined}
        >
          Edit
        </Button>
        <Modal.Backdrop>
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog className="border border-surface-border bg-surface sm:max-w-[600px]">
              <Modal.CloseTrigger />
              <Modal.Header className="pr-7">
                <Modal.Heading className="text-lg font-semibold text-foreground">Edit resources and scaling</Modal.Heading>
                <p className="mt-1 text-xs leading-5 text-muted-text">
                  <span className="font-mono text-foreground">{deployment.name}</span>
                  {" · "}Resources are allocated to each replica.
                </p>
              </Modal.Header>
              {session && (
                <DeploymentSpecForm
                  key={session.fingerprint}
                  deploymentId={deployment.id}
                  baseline={session.configuration}
                  baselineChanged={session.fingerprint !== fingerprint}
                  reloadUnavailableReason={unavailableReason}
                  onReload={openCurrentConfiguration}
                  onCancel={(): void => setSession(null)}
                />
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {unavailableReason && (
        <div className="text-right text-[11px] leading-4 text-muted-text">
          <p id={reasonId}>{unavailableReason}</p>
          {!getDeploymentComputeConfiguration(deployment) && deployment.resource_id && (
            <Button variant="ghost" size="sm" className="mt-1" onPress={(): void => router.refresh()}>
              Refresh configuration
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
