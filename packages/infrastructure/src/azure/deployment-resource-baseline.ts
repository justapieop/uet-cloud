import { createHash } from "node:crypto";
import type { Container, ContainerApp, Revision, Template, TrafficWeight } from "@azure/arm-appcontainers";
import { DeploymentConfigurationReadError, DeploymentResourceUpdateError } from "@kumo/application";
import { validateDeploymentResourceConfiguration, type DeploymentResourceBaseline, type DeploymentResourceConfigurationDetails } from "@kumo/domain";
import { normalizeAzureRegion } from "./region.js";

export interface DeploymentResourceIdentity {
  readonly resourceId: string;
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
  readonly abortSignal?: AbortSignal;
}

export class AzureResourceBaselineError extends DeploymentResourceUpdateError {
  public constructor(code: "RESOURCE_BASELINE_UNSETTLED" | "RESOURCE_REVISION_MODE_UNSUPPORTED" | "RESOURCE_STOPPED_UNSUPPORTED") {
    super(code, code === "RESOURCE_BASELINE_UNSETTLED" ? "The applied resource configuration does not have a stable ready revision" :
      code === "RESOURCE_STOPPED_UNSUPPORTED" ? "Updating stopped applications is unavailable until Azure preservation has been verified" :
        "Resource updates require Single revision mode without pinned or split traffic");
  }
}

export function mainContainer(template: Template | undefined, appName: string): Container {
  const containers: Container[] = template?.containers ?? [];
  if (!Array.isArray(containers)) throw new DeploymentConfigurationReadError("invalid");
  const container: Container | undefined = containers.find((item: Container): boolean => item.name === appName)
    ?? (containers.length === 1 ? containers[0] : undefined);
  if (typeof container?.name !== "string" || container.name.trim().length === 0) throw new DeploymentConfigurationReadError("invalid");
  return container;
}

export function memoryGiB(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new DeploymentConfigurationReadError("invalid");
  const match: RegExpMatchArray | null = value.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)$/);
  if (!match) throw new DeploymentConfigurationReadError("invalid");
  const factors: Readonly<Record<string, number>> = { Ki: 1 / 1048576, Mi: 1 / 1024, Gi: 1, Ti: 1024 };
  const memory: number = Number(match[1]) * factors[match[2]!]!;
  if (!Number.isFinite(memory) || memory <= 0) throw new DeploymentConfigurationReadError("invalid");
  return memory;
}

export function resourceConfiguration(template: Template | undefined, appName: string): DeploymentResourceConfigurationDetails {
  const container: Container = mainContainer(template, appName);
  const configuration: DeploymentResourceConfigurationDetails = {
    maxVcpu: container.resources?.cpu ?? Number.NaN,
    maxMemory: memoryGiB(container.resources?.memory) ?? Number.NaN,
    minScaling: template?.scale?.minReplicas ?? Number.NaN,
    maxScaling: template?.scale?.maxReplicas ?? Number.NaN,
  };
  if (validateDeploymentResourceConfiguration(configuration)) throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
  return configuration;
}

export function sameResourceConfiguration(left: DeploymentResourceConfigurationDetails, right: DeploymentResourceConfigurationDetails): boolean {
  return left.maxVcpu === right.maxVcpu && left.maxMemory === right.maxMemory && left.minScaling === right.minScaling && left.maxScaling === right.maxScaling;
}

export function requireSingleRevision(app: ContainerApp): void {
  const traffic: TrafficWeight[] = app.configuration?.ingress?.traffic ?? [];
  if (!Array.isArray(traffic) || app.configuration?.activeRevisionsMode !== "Single" || traffic.length > 1 ||
    traffic.some((item: TrafficWeight): boolean => Boolean(item.revisionName || item.label) || item.latestRevision !== true || (item.weight !== undefined && item.weight !== 100))) {
    throw new AzureResourceBaselineError("RESOURCE_REVISION_MODE_UNSUPPORTED");
  }
}

export function revisionMatchesIdentity(revision: Revision, resourceId: string, revisionName: string): boolean {
  const expected: string = `${resourceId}/revisions/${revisionName}`.toLowerCase();
  return revision.id !== undefined ? typeof revision.id === "string" && revision.id.toLowerCase() === expected : revision.name === revisionName;
}

export function readyRevision(app: ContainerApp, revision: Revision, revisionName: string, configuration: DeploymentResourceConfigurationDetails): boolean {
  const scaleToZero: boolean = configuration.minScaling === 0 && revision.replicas === 0;
  return app.provisioningState === "Succeeded" && app.latestRevisionName === revisionName && app.latestReadyRevisionName === revisionName &&
    revision.provisioningState === "Provisioned" && revision.active === true && revision.healthState !== "Unhealthy" &&
    (revision.runningState === "Running" || (scaleToZero && revision.runningState === "Stopped"));
}

export function createResourceBaseline(app: ContainerApp, revision: Revision, identity: DeploymentResourceIdentity, environmentId: string): DeploymentResourceBaseline {
  requireSingleRevision(app);
  const revisionName: string | undefined = app.latestRevisionName;
  if (!revisionName || !revisionMatchesIdentity(revision, identity.resourceId, revisionName)) throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
  const container: Container = mainContainer(app.template, identity.appName);
  const revisionContainer: Container = mainContainer(revision.template, identity.appName);
  const configuration: DeploymentResourceConfigurationDetails = resourceConfiguration(app.template, identity.appName);
  if (typeof container.image !== "string" || container.image.trim().length === 0 || revisionContainer.image !== container.image || revisionContainer.name !== container.name ||
    !sameResourceConfiguration(configuration, resourceConfiguration(revision.template, identity.appName)) ||
    !readyRevision(app, revision, revisionName, configuration) || (app.runningStatus !== "Running" && app.runningStatus !== "Stopped")) {
    throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
  }
  const version: string = createHash("sha256").update(JSON.stringify([
    "kumo-resource-configuration-v1", identity.resourceId.toLowerCase(), environmentId.toLowerCase(), normalizeAzureRegion(app.location!),
    "Single", container.name, container.image, revisionName, configuration.maxVcpu, configuration.maxMemory, configuration.minScaling, configuration.maxScaling,
  ])).digest("hex");
  return { configuration, version: `v1-${version}`, image: container.image, mainContainerName: container.name!, revisionName,
    resourceId: identity.resourceId, environmentId, revisionMode: "Single", runningStatus: app.runningStatus };
}
