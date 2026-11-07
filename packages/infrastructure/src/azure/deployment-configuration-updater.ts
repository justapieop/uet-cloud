import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Container, ContainerApp, ContainerAppsAPIClient, Revision } from "@azure/arm-appcontainers";
import { DeploymentConfigurationReadError, DeploymentResourceUpdateError, type DeploymentConfigurationIdentity, type DeploymentConfigurationUpdater, type DeploymentResourceApplyInput, type DeploymentResourceApplyResult, type DeploymentResourceReconcileInput, type DeploymentResourceReconcileResult } from "@kumo/application";
import { validateDeploymentResourceConfiguration, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails } from "@kumo/domain";
import type { ConfigService } from "@nestjs/config";
import { AzureDeploymentConfigurationReader, type DeploymentRevisionReader } from "./deployment-configuration.js";
import { AzureResourceBaselineError, mainContainer, readyRevision, requireSingleRevision, resourceConfiguration, revisionMatchesIdentity, sameResourceConfiguration, type DeploymentResourceIdentity } from "./deployment-resource-baseline.js";
import { ownedContainerAppResource } from "./workload-scope.js";

export const RESOURCE_UPDATE_OPERATION_TAG: string = "kumo-resource-update-id";

/** The short suffix keeps even a 32-character app's full revision name below 64 characters. */
export function resourceUpdateRevisionSuffix(operationId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new DeploymentResourceUpdateError("RESOURCE_OPERATION_INVALID", "The resource operation identity is invalid");
  }
  return `r${createHash("sha256").update(operationId.toLowerCase()).digest("hex").slice(0, 28)}`;
}

export class AzureDeploymentConfigurationUpdater implements DeploymentConfigurationUpdater {
  // ARM exposes runningStatus as read-only. Stopped preservation needs environment-specific live proof.
  public readonly supportsStopped: boolean = false;
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(
    config: ConfigService,
    private readonly apps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "update">,
    private readonly revisions: DeploymentRevisionReader,
    private readonly reader: AzureDeploymentConfigurationReader,
  ) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    this.pollIntervalMs = Number(config.get<string>("AZURE_DEPLOYMENT_POLL_INTERVAL_MS", "5000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0 || this.pollIntervalMs > this.timeoutMs) {
      throw new DeploymentResourceUpdateError("RESOURCE_CONFIGURATION_INVALID", "Resource update timeout and polling interval are invalid");
    }
  }

  public readBaseline(input: DeploymentConfigurationIdentity): Promise<DeploymentResourceBaseline> {
    return this.reader.readBaseline(input);
  }

  public async update(input: DeploymentResourceApplyInput): Promise<DeploymentResourceApplyResult> {
    if (validateDeploymentResourceConfiguration(input.requested)) {
      throw new DeploymentResourceUpdateError("RESOURCE_CONFIGURATION_INVALID", "The requested compute configuration is invalid");
    }
    if (input.lifecycle === "STOPPED") throw new AzureResourceBaselineError("RESOURCE_STOPPED_UNSUPPORTED");
    const signal: AbortSignal = AbortSignal.any([input.abortSignal, AbortSignal.timeout(this.timeoutMs)]);
    const identity: DeploymentResourceIdentity = { ...input, abortSignal: signal };
    const initial: Awaited<ReturnType<AzureDeploymentConfigurationReader["readVerifiedSnapshot"]>> = await this.readPreflight(identity);
    this.requireBaseline(input.baseline, initial.baseline);
    if (initial.baseline.runningStatus !== "Running") throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
    const noOp: boolean = sameResourceConfiguration(initial.baseline.configuration, input.requested);
    const suffix: string = resourceUpdateRevisionSuffix(input.operationId);
    const targetRevision: string = noOp ? initial.baseline.revisionName : `${input.appName}--${suffix}`;
    // Persist a safe recovery marker before sending anything that can create a revision.
    await input.onTargetRevision(targetRevision);
    signal.throwIfAborted();
    const fresh: Awaited<ReturnType<AzureDeploymentConfigurationReader["readVerifiedSnapshot"]>> = await this.readPreflight(identity);
    this.requireBaseline(input.baseline, fresh.baseline);
    if (fresh.baseline.runningStatus !== "Running") throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
    if (noOp) return { observed: fresh.baseline.configuration, targetRevision, noOp: true };
    const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
    if (!resource) throw new DeploymentConfigurationReadError("invalid");
    const app: ContainerApp = fresh.app;
    const containers: Container[] = app.template?.containers ?? [];
    const envelope: ContainerApp = {
      location: app.location,
      tags: { ...app.tags, [RESOURCE_UPDATE_OPERATION_TAG]: input.operationId },
      template: {
        ...app.template, revisionSuffix: suffix,
        containers: containers.map((container: Container): Container => container.name === fresh.baseline.mainContainerName ? {
          ...container, resources: { ...container.resources, cpu: input.requested.maxVcpu, memory: `${input.requested.maxMemory}Gi` },
        } : container),
        scale: { ...app.template?.scale, minReplicas: input.requested.minScaling, maxReplicas: input.requested.maxScaling },
      },
    };
    signal.throwIfAborted();
    try {
      // One write attempt. Poller completion alone never proves the revision is ready.
      await this.apps.update(resource.resourceGroup, input.appName, envelope, { abortSignal: signal }).pollUntilDone({ abortSignal: signal });
    } catch (error: unknown) {
      // Poller errors may follow ARM acceptance, including a failed readiness rollout.
      // Never clear the command guard or resubmit based solely on an HTTP/timeout error.
      throw new DeploymentResourceUpdateError("RESOURCE_WRITE_OUTCOME_UNKNOWN", "Azure resource update requires reconciliation", true);
    }
    try {
      while (true) {
        signal.throwIfAborted();
        const result: DeploymentResourceReconcileResult = await this.reconcile({ ...input, targetRevision, abortSignal: signal });
        if (result.outcome === "succeeded") return { observed: result.observed, targetRevision: result.targetRevision, noOp: result.noOp };
        if (result.outcome === "failed") throw new DeploymentResourceUpdateError(result.errorCode, result.errorMessage);
        await delay(this.pollIntervalMs, undefined, { signal });
      }
    } catch (error: unknown) {
      if (error instanceof DeploymentResourceUpdateError) throw error;
      throw new DeploymentResourceUpdateError("RESOURCE_READINESS_UNKNOWN", "Azure has not confirmed the target revision is ready", true);
    }
  }

  public async reconcile(input: DeploymentResourceReconcileInput): Promise<DeploymentResourceReconcileResult> {
    const signal: AbortSignal = AbortSignal.any([input.abortSignal, AbortSignal.timeout(15_000)]);
    const identity: DeploymentResourceIdentity = { ...input, abortSignal: signal };
    let observed: DeploymentResourceConfigurationDetails | null = null;
    if (input.targetRevision === input.baseline.revisionName && sameResourceConfiguration(input.requested, input.baseline.configuration)) {
      // This marker is reserved for no-op commands. Their verified initial baseline
      // already equals requested, so this command can never submit an ARM write.
      try {
        const baseline: DeploymentResourceBaseline = await this.reader.readBaseline(identity);
        this.requireBaseline(input.baseline, baseline);
        if (baseline.runningStatus !== (input.lifecycle === "RUNNING" ? "Running" : "Stopped")) {
          throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
        }
        return { outcome: "succeeded", observed: baseline.configuration, targetRevision: baseline.revisionName, noOp: true };
      } catch (error: unknown) {
        return { outcome: "failed", targetRevision: input.targetRevision,
          errorCode: "RESOURCE_NO_OP_UNCONFIRMED", errorMessage: "The original no-op baseline could no longer be verified; no Azure write was submitted" };
      }
    }
    try {
      if (!input.targetRevision) return { outcome: "unknown" };
      const app: ContainerApp = await this.reader.readApp(identity);
      requireSingleRevision(app);
      if (this.reader.environmentId(input, app).toLowerCase() !== input.baseline.environmentId.toLowerCase()) return { outcome: "unknown" };
      observed = resourceConfiguration(app.template, input.appName);
      const expectedTarget: string = `${input.appName}--${resourceUpdateRevisionSuffix(input.operationId)}`;
      if (input.targetRevision !== expectedTarget || app.tags?.[RESOURCE_UPDATE_OPERATION_TAG] !== input.operationId) {
        return { outcome: "unknown", observed, targetRevision: input.targetRevision };
      }
      const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
      if (!resource) throw new DeploymentConfigurationReadError("invalid");
      const revision: Revision = await this.revisions.getRevision(resource.resourceGroup, input.appName, input.targetRevision, { abortSignal: signal });
      if (!revisionMatchesIdentity(revision, input.resourceId, input.targetRevision)) return { outcome: "unknown", observed, targetRevision: input.targetRevision };
      const main: Container = mainContainer(app.template, input.appName);
      const targetMain: Container = mainContainer(revision.template, input.appName);
      const targetConfiguration: DeploymentResourceConfigurationDetails = resourceConfiguration(revision.template, input.appName);
      const runningMatches: boolean = input.lifecycle === "RUNNING" ? app.runningStatus === "Running" : app.runningStatus === "Stopped";
      if (runningMatches && main.name === input.baseline.mainContainerName && targetMain.name === input.baseline.mainContainerName &&
        main.image === input.baseline.image && targetMain.image === input.baseline.image && sameResourceConfiguration(observed, input.requested) &&
        sameResourceConfiguration(targetConfiguration, input.requested) && readyRevision(app, revision, input.targetRevision, input.requested)) {
        return { outcome: "succeeded", observed, targetRevision: input.targetRevision, noOp: false };
      }
      // A terminal failed target is evidence of a failed rollout; it does not promise a rollback.
      if (app.latestRevisionName === input.targetRevision && (app.provisioningState === "Succeeded" || app.provisioningState === "Failed" || app.provisioningState === "Canceled") &&
        (revision.provisioningState === "Failed" || (revision.runningState === "Failed" && revision.provisioningState === "Provisioned"))) {
        return { outcome: "failed", observed, targetRevision: input.targetRevision,
          errorCode: "RESOURCE_REVISION_FAILED", errorMessage: "Azure could not make the requested resource revision ready" };
      }
      return { outcome: "unknown", observed, targetRevision: input.targetRevision };
    } catch (error: unknown) {
      // Missing target/temporary ARM failures cannot prove an earlier accepted PATCH did not run.
      return { outcome: "unknown", observed, targetRevision: input.targetRevision };
    }
  }

  private async readPreflight(identity: DeploymentResourceIdentity): ReturnType<AzureDeploymentConfigurationReader["readVerifiedSnapshot"]> {
    try { return await this.reader.readVerifiedSnapshot(identity); }
    catch (error: unknown) {
      if (error instanceof DeploymentResourceUpdateError) throw error;
      throw new DeploymentResourceUpdateError("RESOURCE_PREFLIGHT_UNAVAILABLE", "Azure could not verify the resource configuration before the write");
    }
  }

  private requireBaseline(expected: DeploymentResourceBaseline, actual: DeploymentResourceBaseline): void {
    if (expected.version !== actual.version || expected.resourceId.toLowerCase() !== actual.resourceId.toLowerCase() ||
      expected.environmentId.toLowerCase() !== actual.environmentId.toLowerCase() || expected.image !== actual.image || expected.mainContainerName !== actual.mainContainerName) {
      throw new DeploymentResourceUpdateError("RESOURCE_BASELINE_CHANGED", "The applied deployment configuration changed after acceptance");
    }
  }
}
