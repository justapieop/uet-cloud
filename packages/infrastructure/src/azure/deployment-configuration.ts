import type { ContainerApp, ContainerAppsAPIClient, Container, Ingress, IngressPortMapping, Revision, VolumeMount } from "@azure/arm-appcontainers";
import { DeploymentConfigurationReadError, type DeploymentConfiguration, type DeploymentConfigurationReader } from "@kumo/application";
import type { DeploymentPortMapping, DeploymentResourceBaseline, DeploymentVolume } from "@kumo/domain";
import { ResilienceError } from "@nestjs/resilience";
import type { ConfigService } from "@nestjs/config";
import { normalizeAzureRegion } from "./region.js";
import { ownedContainerAppResource } from "./workload-scope.js";
import { AzureResourceBaselineError, createResourceBaseline, mainContainer, memoryGiB, requireSingleRevision, type DeploymentResourceIdentity } from "./deployment-resource-baseline.js";

export type DeploymentRevisionReader = Pick<ContainerAppsAPIClient["containerAppsRevisions"], "getRevision">;

export class AzureDeploymentConfigurationReader implements DeploymentConfigurationReader {
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;
  private readonly sharedEnvironmentId: string | null;

  public constructor(
    config: ConfigService,
    private readonly apps: Pick<ContainerAppsAPIClient["containerApps"], "get">,
    private readonly revisions?: DeploymentRevisionReader,
  ) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    const environmentName: string | undefined = config.get<string>("AZURE_SHARED_ENVIRONMENT_NAME");
    this.sharedEnvironmentId = environmentName ? `/subscriptions/${this.subscriptionId}/resourceGroups/${this.platformResourceGroup}/providers/Microsoft.App/managedEnvironments/${environmentName}` : null;
  }

  public async read(input: Parameters<DeploymentConfigurationReader["read"]>[0]): Promise<DeploymentConfiguration> {
    const app: ContainerApp = await this.readApp(input);
    const container: Container = mainContainer(app.template, input.appName);
    const ingress: Ingress | undefined = app.configuration?.ingress;
    if (ingress?.external !== undefined && typeof ingress.external !== "boolean") throw new DeploymentConfigurationReadError("invalid");
    let baseline: DeploymentResourceBaseline | null = null;
    if (this.revisions) {
      try { baseline = await this.baselineFromApp(input, app); }
      catch (error: unknown) { if (!(error instanceof AzureResourceBaselineError)) throw error; }
    }
    return {
      ...(this.revisions ? { configurationVersion: baseline?.version ?? null, resourceBaseline: baseline } : {}),
      region: normalizeAzureRegion(app.location!),
      maxVcpu: this.number(container.resources?.cpu),
      maxMemory: memoryGiB(container.resources?.memory),
      minScaling: this.number(app.template?.scale?.minReplicas),
      maxScaling: this.number(app.template?.scale?.maxReplicas),
      targetPort: this.number(ingress?.targetPort),
      external: ingress?.external ?? null,
      additionalPorts: (ingress?.additionalPortMappings ?? []).map((port: IngressPortMapping): DeploymentPortMapping => ({
        targetPort: port.targetPort, exposedPort: port.exposedPort ?? port.targetPort, external: port.external ?? false,
      })),
      ...(container.volumeMounts && container.volumeMounts.length > 0 ? {
        volumes: container.volumeMounts.map((mount: VolumeMount): DeploymentVolume => ({
          name: mount.volumeName ?? "", mountPath: mount.mountPath ?? "", subPath: mount.subPath || undefined, sizeGb: 1, accessMode: "ReadWrite",
        })),
      } : {}),
      image: container.image ?? null,
      fqdn: ingress?.fqdn ?? null,
    };
  }

  public async readBaseline(input: DeploymentResourceIdentity): Promise<DeploymentResourceBaseline> {
    return (await this.readVerifiedSnapshot(input)).baseline;
  }

  public async readVerifiedSnapshot(input: DeploymentResourceIdentity): Promise<{ readonly app: ContainerApp; readonly baseline: DeploymentResourceBaseline }> {
    const app: ContainerApp = await this.readApp(input);
    return { app, baseline: await this.baselineFromApp(input, app) };
  }

  public async readApp(input: DeploymentResourceIdentity): Promise<ContainerApp> {
    const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
    if (!resource) throw new DeploymentConfigurationReadError("invalid");
    let app: ContainerApp;
    try {
      app = await this.apps.get(resource.resourceGroup, input.appName, { abortSignal: this.readSignal(input.abortSignal) });
    } catch (error: unknown) { throw this.readError(error); }
    if (typeof app.id !== "string" || app.id.toLowerCase() !== resource.resourceId.toLowerCase() || app.tags?.["kumo-deployment-id"] !== input.deploymentId ||
      typeof app.location !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(normalizeAzureRegion(app.location))) {
      throw new DeploymentConfigurationReadError("invalid");
    }
    // Existing projections can still be read without a configured shared environment.
    // A verified baseline always validates the applied environment below.
    return app;
  }

  public async readRevision(input: DeploymentResourceIdentity, revisionName: string): Promise<Revision> {
    const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
    if (!resource) throw new DeploymentConfigurationReadError("invalid");
    if (!this.revisions) throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
    try {
      return await this.revisions.getRevision(resource.resourceGroup, input.appName, revisionName, { abortSignal: this.readSignal(input.abortSignal) });
    } catch (error: unknown) { throw this.readError(error); }
  }

  public environmentId(input: DeploymentResourceIdentity, app: ContainerApp): string {
    const environmentId: string | undefined = app.environmentId ?? app.managedEnvironmentId;
    const legacyId: string = `/subscriptions/${this.subscriptionId}/resourceGroups/user-rg-${input.userId}/providers/Microsoft.App/managedEnvironments/user-aca-env-${input.userId}`;
    if (typeof environmentId !== "string" || (environmentId.toLowerCase() !== this.sharedEnvironmentId?.toLowerCase() && environmentId.toLowerCase() !== legacyId.toLowerCase())) {
      throw new DeploymentConfigurationReadError("invalid");
    }
    return environmentId;
  }

  private async baselineFromApp(input: DeploymentResourceIdentity, app: ContainerApp): Promise<DeploymentResourceBaseline> {
    requireSingleRevision(app);
    if (app.provisioningState !== "Succeeded" || !app.latestRevisionName || app.latestRevisionName !== app.latestReadyRevisionName) {
      throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
    }
    const environmentId: string = this.environmentId(input, app);
    let revision: Revision;
    try { revision = await this.readRevision(input, app.latestRevisionName); }
    catch (error: unknown) {
      if (error instanceof DeploymentConfigurationReadError && error.reason === "missing") throw new AzureResourceBaselineError("RESOURCE_BASELINE_UNSETTLED");
      throw error;
    }
    return createResourceBaseline(app, revision, input, environmentId);
  }

  private readSignal(signal?: AbortSignal): AbortSignal {
    const timeout: AbortSignal = AbortSignal.timeout(15_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private readError(error: unknown): Error {
    if (error instanceof ResilienceError) return error;
    const status: unknown = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    return new DeploymentConfigurationReadError(status === 404 ? "missing" : status === 403 ? "invalid" : "unavailable");
  }

  private number(value: number | undefined): number | null {
    if (value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) throw new DeploymentConfigurationReadError("invalid");
    return value;
  }
}

export { memoryGiB as azureMemoryGiB } from "./deployment-resource-baseline.js";
