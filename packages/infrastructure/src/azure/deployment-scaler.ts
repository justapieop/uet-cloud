import { setTimeout as delay } from "node:timers/promises";
import type { ContainerApp, ContainerAppsAPIClient, Replica, ReplicaCollection, ReplicaContainer, Revision } from "@azure/arm-appcontainers";
import { DeploymentScalingUnavailableError, type DeploymentScaler, type DeploymentScalingIdentity, type DeploymentScalingSnapshot } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import { ownedContainerAppResource } from "./workload-scope.js";
import { azureMemoryGiB } from "./deployment-configuration.js";

export interface DeploymentScalingClients {
  readonly containerApps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "update">;
  readonly revisions: Pick<ContainerAppsAPIClient["containerAppsRevisions"], "getRevision">;
  readonly replicas: Pick<ContainerAppsAPIClient["containerAppsRevisionReplicas"], "listReplicas">;
}

export class AzureDeploymentScaler implements DeploymentScaler {
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;

  public constructor(config: ConfigService, private readonly clients: DeploymentScalingClients) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) throw new Error("Invalid scaling operation timeout");
  }

  public async inspect(input: DeploymentScalingIdentity, signal: AbortSignal): Promise<DeploymentScalingSnapshot> {
    const operationSignal: AbortSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const resource: NonNullable<ReturnType<typeof ownedContainerAppResource>> = this.resource(input);
    const app: ContainerApp = await this.clients.containerApps.get(resource.resourceGroup, input.appName, { abortSignal: operationSignal });
    return this.snapshot(input, app, operationSignal);
  }

  public async scale(input: Parameters<DeploymentScaler["scale"]>[0], signal: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(input.targetReplicas) || input.targetReplicas < 1 || input.targetReplicas > 1000 ||
      !/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new DeploymentScalingUnavailableError();
    const operationSignal: AbortSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const resource: NonNullable<ReturnType<typeof ownedContainerAppResource>> = this.resource(input);
    const app: ContainerApp = await this.clients.containerApps.get(resource.resourceGroup, input.appName, { abortSignal: operationSignal });
    const current: DeploymentScalingSnapshot = await this.snapshot(input, app, operationSignal);
    if (current.revisionName !== input.expected.revisionName || current.cpuCores !== input.expected.cpuCores || current.memoryGiB !== input.expected.memoryGiB ||
      current.replicaNames.length !== input.expected.replicaNames.length || current.replicaNames.some((name: string): boolean => !input.expected.replicaNames.includes(name))) {
      throw new DeploymentScalingUnavailableError();
    }
    const suffix: string = `scale-${input.operationId.replaceAll("-", "")}`;
    const revisionName: string = `${input.appName}--${suffix}`;
    // ACA owns scheduling, readiness, and traffic switching. Pin its bounds to
    // implement one desired count; do not run another native scaling policy.
    // PATCH the live template only; app secrets/identities/ingress stay in ACA.
    await this.clients.containerApps.update(resource.resourceGroup, input.appName, {
      location: app.location,
      template: { ...app.template, revisionSuffix: suffix,
        scale: { ...app.template?.scale, minReplicas: input.targetReplicas, maxReplicas: input.targetReplicas } },
    }, { abortSignal: operationSignal }).pollUntilDone({ abortSignal: operationSignal });

    for (;;) {
      operationSignal.throwIfAborted();
      const applied: ContainerApp = await this.clients.containerApps.get(resource.resourceGroup, input.appName, { abortSignal: operationSignal });
      this.assertOwned(input, applied);
      if (applied.provisioningState === "Failed" || applied.provisioningState === "Canceled") throw new DeploymentScalingUnavailableError();
      if (applied.latestRevisionName !== revisionName && applied.latestRevisionName !== input.expected.revisionName) throw new DeploymentScalingUnavailableError();
      if (applied.latestReadyRevisionName === revisionName && applied.template?.scale?.minReplicas === input.targetReplicas &&
        applied.template.scale.maxReplicas === input.targetReplicas) {
        const ready: DeploymentScalingSnapshot | null = await this.readySnapshot(input, applied, operationSignal);
        if (ready?.replicaNames.length === input.targetReplicas) return;
      }
      await delay(5000, undefined, { signal: operationSignal });
    }
  }

  private resource(input: DeploymentScalingIdentity): NonNullable<ReturnType<typeof ownedContainerAppResource>> {
    const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
    if (!resource) throw new DeploymentScalingUnavailableError();
    return resource;
  }

  private assertOwned(input: DeploymentScalingIdentity, app: ContainerApp): void {
    const resource: NonNullable<ReturnType<typeof ownedContainerAppResource>> = this.resource(input);
    if (app.id?.toLowerCase() !== resource.resourceId.toLowerCase() || app.tags?.["kumo-deployment-id"] !== input.deploymentId) throw new DeploymentScalingUnavailableError();
  }

  private async snapshot(input: DeploymentScalingIdentity, app: ContainerApp, signal: AbortSignal): Promise<DeploymentScalingSnapshot> {
    const snapshot: DeploymentScalingSnapshot | null = await this.readySnapshot(input, app, signal);
    if (!snapshot) throw new DeploymentScalingUnavailableError();
    return snapshot;
  }

  private async readySnapshot(input: DeploymentScalingIdentity, app: ContainerApp, signal: AbortSignal): Promise<DeploymentScalingSnapshot | null> {
    this.assertOwned(input, app);
    if (app.configuration?.activeRevisionsMode !== "Single" || !app.configuration.ingress?.fqdn ||
      app.template?.containers?.length !== 1 || (app.template.scale?.rules?.length ?? 0) > 0 ||
      app.provisioningState !== "Succeeded" || app.runningStatus !== "Running" ||
      !app.latestRevisionName || app.latestRevisionName !== app.latestReadyRevisionName) return null;
    const cpuCores: number | undefined = app.template.containers[0]!.resources?.cpu;
    const memoryGiB: number | null = azureMemoryGiB(app.template.containers[0]!.resources?.memory);
    if (typeof cpuCores !== "number" || !Number.isFinite(cpuCores) || cpuCores <= 0 || memoryGiB === null) return null;
    const group: string = this.resource(input).resourceGroup;
    const revision: Revision = await this.clients.revisions.getRevision(group, input.appName, app.latestRevisionName, { abortSignal: signal });
    if (revision.provisioningState === "Failed" || revision.healthState === "Unhealthy") throw new DeploymentScalingUnavailableError();
    if (revision.name !== app.latestRevisionName || revision.active !== true || revision.healthState !== "Healthy" ||
      revision.provisioningState !== "Provisioned" || revision.trafficWeight !== 100 || !revision.createdTime ||
      !Number.isSafeInteger(revision.replicas) || revision.replicas! < 1) return null;
    const replicas: ReplicaCollection = await this.clients.replicas.listReplicas(group, input.appName, app.latestRevisionName, { abortSignal: signal });
    if (replicas.value.length !== revision.replicas || replicas.value.some((replica: Replica): boolean =>
      !replica.name || replica.runningState !== "Running" || replica.containers?.length !== 1 ||
      replica.containers.some((container: ReplicaContainer): boolean => container.ready !== true || container.started !== true))) return null;
    return { revisionName: app.latestRevisionName, replicaNames: replicas.value.map((replica: Replica): string => replica.name!), cpuCores, memoryGiB, revisionCreatedAt: revision.createdTime };
  }
}
