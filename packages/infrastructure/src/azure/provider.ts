import type { AzureFileProperties, ContainerAppsAPIClient, Container, ContainerApp, ContainerResources, EnvironmentVar, ManagedEnvironment, Volume, VolumeMount, WorkloadProfile } from "@azure/arm-appcontainers";
import type { ResourceManagementClient, ResourceGroup } from "@azure/arm-resources";
import type { StorageManagementClient, StorageAccountListKeysResult } from "@azure/arm-storage";
import { BuildProviderError, type DeploymentProvisioner, type DeploymentProvisionInput, type DeploymentProvisionResult, type GetBuildCase, type TriggerBuildCase, type TriggerBuildInput, type TriggerBuildResult, type VolumeManager } from "@kumo/application";
import { validateDeploymentPorts, validateDeploymentVolumes, type BuildDetails, type DeploymentPortMapping, type DeploymentVolume, type InvalidDomainParams } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeAzureRegion } from "./region.js";
import { describeBuildFailure, runBuildStep } from "../build-errors.js";
import { ownedContainerAppResource, userWorkloadResourceGroup } from "./workload-scope.js";

import type { FeatureFlagConfiguration } from "../feature-flags/provider.js";
import { legacyProvisioningEnabled } from "../feature-flags/legacy-provisioning.js";
import { AzureLegacyEnvironmentProvisioner } from "./legacy-environment.js";
import { managedEnvironmentReference, sharedEnvironmentReference, validateEnvironment, type ManagedEnvironmentReference } from "./shared-environment.js";

export interface AzureRgInput {
  userId: string;
  region?: string;
  abortSignal?: AbortSignal;
}

export interface AzureAcaEnvInput extends AzureRgInput { environmentId?: string; }

export interface AzureDeploymentCreateInput extends AzureAcaEnvInput {
  name: string;
  repo: string;
  imageName?: string;
  dockerFilePath?: string;
  ref?: string;
  targetPort: number;
  external?: boolean;
  additionalPorts?: readonly DeploymentPortMapping[];
  resources?: ContainerResources;
  envVars?: Readonly<Record<string, string>>;
  minReplicas?: number;
  maxReplicas?: number;
  deploymentId?: string;
  resourceId?: string;
  volumes?: readonly DeploymentVolume[];
  onBuildAccepted?: (id: string, image: string) => Promise<void>;
}

export interface AzureProviderClients {
  resources: Pick<ResourceManagementClient["resources"], "getById"> & Partial<Pick<ResourceManagementClient["resources"], "createOrUpdateById">>;
  resourceGroups: Pick<ResourceManagementClient["resourceGroups"], "checkExistence" | "get" | "createOrUpdate">;
  managedEnvironments: Pick<ContainerAppsAPIClient["managedEnvironments"], "get">;
  containerApps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "createOrUpdate" | "update">;
  managedEnvironmentsStorages?: Pick<ContainerAppsAPIClient["managedEnvironmentsStorages"], "createOrUpdate" | "delete" | "get">;
  storageAccounts?: Pick<StorageManagementClient["storageAccounts"], "create" | "getProperties"> & Partial<Pick<StorageManagementClient["storageAccounts"], "listKeys">>;
  fileShares?: Pick<StorageManagementClient["fileShares"], "create" | "get" | "delete">;
}

@Injectable()
export class AzureProvider implements DeploymentProvisioner, VolumeManager {
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private legacy: Pick<AzureLegacyEnvironmentProvisioner, "getAcaEnvironment"> | null = null;

  public constructor(
    private readonly config: ConfigService,
    private readonly triggerBuild: Pick<TriggerBuildCase, "exec">,
    private readonly getBuild: Pick<GetBuildCase, "exec">,
    private readonly clients: AzureProviderClients,
    private readonly legacyFactory: () => Pick<AzureLegacyEnvironmentProvisioner, "getAcaEnvironment">,
    private readonly featureFlags: FeatureFlagConfiguration,
  ) {
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP")
      ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    this.pollIntervalMs = Number(config.get<string>("AZURE_DEPLOYMENT_POLL_INTERVAL_MS", "5000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0 || this.pollIntervalMs > this.timeoutMs) {
      throw new BuildProviderError("Deployment timeout and polling interval must be positive integers, with the interval no greater than the timeout");
    }
  }

  public async getUserRg(input: AzureRgInput): Promise<ResourceGroup> {
    if (input.region !== undefined && (typeof input.region !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(input.region))) {
      throw new BuildProviderError("Region must be a lowercase Azure region name such as japaneast");
    }
    const rgName: string = this.userResourceGroup(input.userId);
    const exists: boolean = (await runBuildStep("Resource group existence check", () => this.clients.resourceGroups.checkExistence(rgName, { abortSignal: input.abortSignal }))).body;

    if (exists) {
      return runBuildStep("Resource group lookup", () => this.clients.resourceGroups.get(rgName, { abortSignal: input.abortSignal }));
    }

    const location: string = input.region ?? normalizeAzureRegion((await this.getAcaEnvironment(input)).location);
    return runBuildStep("Resource group creation", () => this.clients.resourceGroups.createOrUpdate(rgName, { location }, { abortSignal: input.abortSignal }));
  }

  public async getAcaEnvironment(input: AzureAcaEnvInput): Promise<ManagedEnvironment> {
    const legacyId: string = `/subscriptions/${this.requiredSetting("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${this.userResourceGroup(input.userId)}/providers/Microsoft.App/managedEnvironments/user-aca-env-${input.userId}`;
    if (legacyProvisioningEnabled(this.featureFlags) && (!input.environmentId || input.environmentId.toLowerCase() === legacyId.toLowerCase())) {
      this.legacy ??= this.legacyFactory();
      return this.legacy.getAcaEnvironment({ ...input, requireExisting: Boolean(input.environmentId) });
    }
    const shared: ManagedEnvironmentReference = sharedEnvironmentReference(this.config);
    const selectedId: string = input.environmentId ?? shared.id;
    if (selectedId.toLowerCase() !== shared.id.toLowerCase() && selectedId.toLowerCase() !== legacyId.toLowerCase()) {
      throw new BuildProviderError("Existing Container App does not belong to an allowed managed environment");
    }
    const reference: ManagedEnvironmentReference = managedEnvironmentReference(selectedId, this.requiredSetting("AZURE_SUBSCRIPTION_ID"));
    const signal: AbortSignal = this.operationSignal(input.abortSignal);
    let environment: ManagedEnvironment = await runBuildStep("Managed environment lookup", () =>
      this.clients.managedEnvironments.get(reference.resourceGroup, reference.name, { abortSignal: signal }));
    while (true) {
      const region: string = validateEnvironment(environment, reference, selectedId.toLowerCase() === shared.id.toLowerCase());
      if (input.region !== undefined && input.region !== region) {
        throw new BuildProviderError(`The managed environment is in ${region}; requested region ${input.region} cannot be used`);
      }
      if (environment.provisioningState === "Succeeded") return environment;
      if (!environment.provisioningState || ["Failed", "Canceled", "Deleting"].includes(environment.provisioningState)) {
        throw new BuildProviderError(`Managed environment ${reference.name} is not ready: ${environment.provisioningState ?? "unknown state"}`);
      }
      await delay(this.pollIntervalMs, undefined, { signal });
      environment = await runBuildStep("Managed environment readiness check", () =>
        this.clients.managedEnvironments.get(reference.resourceGroup, reference.name, { abortSignal: signal }));
    }
  }

  public async provisionDeployment(input: DeploymentProvisionInput, onBuildAccepted: (id: string, image: string) => Promise<void>): Promise<DeploymentProvisionResult> {
    const app: ContainerApp = await runBuildStep("Deployment provisioning", () => this.createDeployment({
      ...input.spec, name: input.name, userId: input.userId, deploymentId: input.id, resourceId: input.resourceId,
      resources: { cpu: input.spec.maxVcpu, memory: `${input.spec.maxMemory}Gi` },
      minReplicas: input.spec.minScaling, maxReplicas: input.spec.maxScaling,
      volumes: input.spec.volumes, onBuildAccepted,
    }));
    const buildId: string | undefined = app.tags?.["kumo-build-id"];
    const image: string | undefined = app.template?.containers?.[0]?.image;
    if (!app.id || !buildId || !image || app.provisioningState !== "Succeeded") {
      throw new BuildProviderError("Azure did not return a successfully provisioned app with build metadata");
    }
    return { buildId, image, resourceId: app.id, fqdn: app.configuration?.ingress?.fqdn ?? null };
  }

  public async createDeployment(input: AzureDeploymentCreateInput): Promise<ContainerApp> {
    const portError: InvalidDomainParams | null = validateDeploymentPorts(input.targetPort, input.additionalPorts, input.external);
    if (portError) throw portError;
    const volumeError: InvalidDomainParams | null = validateDeploymentVolumes(input.volumes);
    if (volumeError) throw volumeError;
    const rgName: string = this.userResourceGroup(input.userId);
    if (input.resourceId && (!input.deploymentId || !ownedContainerAppResource({ resourceId: input.resourceId, userId: input.userId, appName: input.name }, this.requiredSetting("AZURE_SUBSCRIPTION_ID"), this.platformResourceGroup))) {
      throw new BuildProviderError("Redeployment resource does not belong to this user");
    }
    if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(input.name)) {
      throw new BuildProviderError("Container App name must be 2-32 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit");
    }

    const minReplicas: number = input.minReplicas ?? 0;
    const maxReplicas: number = input.maxReplicas ?? 2;
    const resources: ContainerResources = input.resources ?? { cpu: 0.25, memory: "0.5Gi" };
    const memory: number = typeof resources.memory === "string" && /^(?:\d+(?:\.\d+)?)Gi$/.test(resources.memory)
      ? Number(resources.memory.slice(0, -2)) : NaN;
    if (typeof resources.cpu !== "number" || !Number.isFinite(resources.cpu) || resources.cpu <= 0 ||
      !Number.isInteger(resources.cpu * 4) || !Number.isFinite(memory) || memory !== resources.cpu * 2) {
      throw new BuildProviderError("Memory in GiB must be exactly twice vCPU; vCPU must be positive in increments of 0.25");
    }
    if (!Number.isInteger(input.targetPort) || input.targetPort < 1 || input.targetPort > 65535 ||
      !Number.isInteger(minReplicas) || minReplicas < 0 || !Number.isInteger(maxReplicas) || maxReplicas < 1 || maxReplicas < minReplicas) {
      throw new BuildProviderError("Invalid container port or replica limits");
    }
    const registry: string = this.requiredSetting("AZURE_CONTAINER_REGISTRY_SERVER");
    const pullIdentityName: string = this.requiredSetting("AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME");
    if (!/^[a-z0-9.-]+$/i.test(registry) ||
      !/^[a-z0-9][a-z0-9_-]{2,127}$/i.test(pullIdentityName)) {
      throw new BuildProviderError("A private registry hostname and valid user-assigned ACR pull identity name are required");
    }
    const pullIdentity: string = `/subscriptions/${this.requiredSetting("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${this.platformResourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${pullIdentityName}`;
    const signal: AbortSignal = this.operationSignal(input.abortSignal);
    // Check the owned app first so legacy deployments keep their existing environment.
    let existing: ContainerApp | undefined;
    try {
      existing = await this.clients.containerApps.get(rgName, input.name, { abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw new BuildProviderError(`Container App lookup failed (${describeBuildFailure(error)})`, { cause: error });
    }
    if (existing && input.deploymentId && existing.tags?.["kumo-deployment-id"] !== input.deploymentId) {
      throw new BuildProviderError("An unrelated Container App already uses this deployment name");
    }
    if (input.resourceId && !existing) throw new BuildProviderError("The existing Container App is missing; redeployment will not recreate it");
    const existingEnvironmentId: string | undefined = existing?.environmentId ?? existing?.managedEnvironmentId;
    if (existing && !existingEnvironmentId) throw new BuildProviderError("Existing Container App has no managed environment identity");
    const environment: ManagedEnvironment = await this.getAcaEnvironment({ ...input, environmentId: existingEnvironmentId, abortSignal: signal });
    if (input.additionalPorts?.some((port: DeploymentPortMapping): boolean => port.external === true) && !environment.vnetConfiguration?.infrastructureSubnetId) {
      throw new BuildProviderError("External additional TCP ports require a managed environment connected to a virtual network");
    }
    if (existing) {
      if (input.resourceId && existing.id?.toLowerCase() !== input.resourceId.toLowerCase()) throw new BuildProviderError("Redeployment resource identity changed");
      if (!input.resourceId) return existing;
    } else {
      await this.getUserRg({ ...input, region: normalizeAzureRegion(environment.location), abortSignal: signal });
    }

    const registryId: string = this.config.get<string>("AZURE_CONTAINER_REGISTRY_RESOURCE_ID")
      ?? `/subscriptions/${this.requiredSetting("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${this.requiredSetting("AZURE_RG_NAME")}/providers/Microsoft.ContainerRegistry/registries/${this.requiredSetting("AZURE_CONTAINER_REGISTRY_NAME")}`;
    if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ContainerRegistry\/registries\/[^/]+$/i.test(registryId)) {
      throw new BuildProviderError("A valid ACR resource ID is required");
    }
    const registryResource: { properties?: unknown } = await runBuildStep("Private registry lookup", () => this.clients.resources.getById(registryId, "2023-07-01", { abortSignal: signal }));
    const registryProperties: unknown = registryResource.properties;
    if (typeof registryProperties !== "object" || registryProperties === null ||
      !("loginServer" in registryProperties) || registryProperties.loginServer !== registry ||
      !("anonymousPullEnabled" in registryProperties) || registryProperties.anonymousPullEnabled !== false) {
      throw new BuildProviderError("The configured ACR must match the image hostname and have anonymous pull disabled before building user images");
    }

    const buildInput: TriggerBuildInput = {
      userId: input.userId, repo: input.repo, imageName: input.imageName ?? input.name,
      dockerFilePath: input.dockerFilePath, ref: input.ref,
    };
    signal.throwIfAborted();
    const build: TriggerBuildResult = await runBuildStep("Build queue submission", () => this.triggerBuild.exec(buildInput));
    if (input.onBuildAccepted) {
      await runBuildStep("Deployment build reference persistence", () => input.onBuildAccepted!(build.buildId, build.image));
    }
    const completed: BuildDetails = await runBuildStep("Build completion wait", () => this.waitForBuild(build.buildId, input.userId, signal));
    if (!completed.image.startsWith(`${registry}/`)) {
      throw new BuildProviderError("Build image does not belong to the configured private registry");
    }
    if (existing && input.resourceId) {
      // Read again after the potentially long build so out-of-band settings are preserved.
      const current: ContainerApp = await runBuildStep("Redeployment configuration lookup", () => this.clients.containerApps.get(rgName, input.name, { abortSignal: signal }));
      if (current.id?.toLowerCase() !== input.resourceId.toLowerCase() || current.tags?.["kumo-deployment-id"] !== input.deploymentId ||
        (current.environmentId ?? current.managedEnvironmentId)?.toLowerCase() !== environment.id!.toLowerCase()) throw new BuildProviderError("Redeployment ownership or environment changed");
      const containers: NonNullable<NonNullable<ContainerApp["template"]>["containers"]> = current.template?.containers ?? [];
      const target: string | undefined = containers.find((container: Container): boolean => container.name === input.name)?.name ?? (containers.length === 1 ? containers[0]?.name : undefined);
      if (!target) throw new BuildProviderError("Redeployment main container could not be identified");
      // PATCH only the revision template/tags; never round-trip masked secret values.
      const updated: ContainerApp = { location: current.location,
        tags: { ...current.tags, "kumo-build-id": build.buildId },
        template: { ...current.template, revisionSuffix: `build-${build.buildId}`,
          containers: containers.map((container: Container): Container => container.name === target ? { ...container, image: completed.image } : container) },
      };
      return runBuildStep("Container App image update", () => this.clients.containerApps.update(rgName, input.name, updated, { abortSignal: signal }).pollUntilDone({ abortSignal: signal }));
    }
    const env: EnvironmentVar[] = Object.entries(input.envVars ?? {}).map(
      ([name, value]: [string, string]): EnvironmentVar => ({ name, value }),
    );
    const volumeDefinitions: Volume[] = [];
    const containerVolumeMounts: VolumeMount[] = [];
    if (input.volumes && input.volumes.length > 0) {
      for (let index: number = 0; index < input.volumes.length; index += 1) {
        const vol: DeploymentVolume = input.volumes[index]!;
        const storageLinkName: string = await this.ensureVolumeStorage(input.userId, input.name, environment, vol, signal);
        volumeDefinitions.push({
          name: vol.name,
          storageType: "AzureFile",
          storageName: storageLinkName,
        });
        containerVolumeMounts.push({
          volumeName: vol.name,
          mountPath: vol.mountPath,
          subPath: vol.subPath,
        });
      }
    }
    const app: ContainerApp = {
      tags: { "kumo-build-id": build.buildId, ...(input.deploymentId ? { "kumo-deployment-id": input.deploymentId } : {}) },
      location: normalizeAzureRegion(environment.location),
      environmentId: environment.id,
      workloadProfileName: environment.workloadProfiles?.find((profile: WorkloadProfile): boolean => profile.workloadProfileType === "Consumption")?.name,
      identity: { type: "UserAssigned", userAssignedIdentities: { [pullIdentity]: {} } },
      configuration: {
        activeRevisionsMode: "Single",
        ingress: {
          external: input.external ?? true, targetPort: input.targetPort, allowInsecure: false,
          additionalPortMappings: input.additionalPorts?.map((port: DeploymentPortMapping) => ({
            targetPort: port.targetPort, exposedPort: port.exposedPort ?? port.targetPort, external: port.external ?? false,
          })),
        },
        registries: [{ server: registry, identity: pullIdentity }],
        identitySettings: [{ identity: pullIdentity, lifecycle: "None" }],
      },
      template: {
        containers: [{
          name: input.name,
          image: completed.image,
          env,
          resources,
          ...(containerVolumeMounts.length > 0 ? { volumeMounts: containerVolumeMounts } : {}),
        }],
        scale: { minReplicas, maxReplicas },
        ...(volumeDefinitions.length > 0 ? { volumes: volumeDefinitions } : {}),
      },
    };
    signal.throwIfAborted();
    return runBuildStep("Container App creation", () => this.clients.containerApps.createOrUpdate(rgName, input.name, app, { abortSignal: signal })
      .pollUntilDone({ abortSignal: signal }));
  }

  private async waitForBuild(id: string, userId: string, signal: AbortSignal): Promise<BuildDetails> {
    while (true) {
      signal.throwIfAborted();
      const build: BuildDetails = await this.getBuild.exec(id, userId);
      if (build.status === "SUCCEEDED") return build;
      if (build.status === "FAILED" || build.status === "CANCELED") {
        throw new BuildProviderError(`Build ${id} ${build.status.toLowerCase()}: ${build.error ?? "Container App creation stopped"}`);
      }
      await delay(this.pollIntervalMs, undefined, { signal });
    }
  }

  private userResourceGroup(userId: string): string {
    if (!/^[0-9]{1,32}$/.test(userId)) throw new BuildProviderError("A valid numeric GitHub user ID is required");
    const name: string | null = userWorkloadResourceGroup(userId, this.platformResourceGroup);
    if (!name) {
      throw new BuildProviderError("User workloads cannot target the platform resource group");
    }
    return name;
  }

  private operationSignal(signal?: AbortSignal): AbortSignal {
    const timeout: AbortSignal = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  public async attachVolume(input: {
    readonly userId: string;
    readonly appName: string;
    readonly deploymentId: string;
    readonly resourceId: string;
    readonly volume: DeploymentVolume;
    readonly existingVolumes: readonly DeploymentVolume[];
  }): Promise<void> {
    const rgName: string = this.userResourceGroup(input.userId);
    const signal: AbortSignal = this.operationSignal();
    const app: ContainerApp = await this.clients.containerApps.get(rgName, input.appName, { abortSignal: signal });
    const existingEnvironmentId: string | undefined = app.environmentId ?? app.managedEnvironmentId;
    if (!existingEnvironmentId) throw new BuildProviderError("Existing Container App has no managed environment identity");
    const environment: ManagedEnvironment = await this.getAcaEnvironment({ userId: input.userId, environmentId: existingEnvironmentId, abortSignal: signal });

    const storageLinkName: string = await this.ensureVolumeStorage(input.userId, input.appName, environment, input.volume, signal);

    const containers: Container[] = app.template?.containers ?? [];
    const container: Container | undefined = containers.find((c: Container): boolean => c.name === input.appName) ?? containers[0];
    if (!container) throw new BuildProviderError("Container App main container not found");

    const updatedVolumeMounts: VolumeMount[] = [
      ...(container.volumeMounts ?? []),
      { volumeName: input.volume.name, mountPath: input.volume.mountPath, subPath: input.volume.subPath },
    ];
    const updatedVolumes: Volume[] = [
      ...(app.template?.volumes ?? []),
      { name: input.volume.name, storageType: "AzureFile", storageName: storageLinkName },
    ];

    const updatedContainers: Container[] = containers.map((c: Container): Container =>
      c.name === container.name ? { ...c, volumeMounts: updatedVolumeMounts } : c,
    );

    const updatedApp: ContainerApp = {
      location: app.location,
      tags: app.tags,
      template: {
        ...app.template,
        revisionSuffix: `vol-${Date.now()}`,
        containers: updatedContainers,
        volumes: updatedVolumes,
      },
    };

    await runBuildStep("Container App volume attach", () =>
      this.clients.containerApps.update(rgName, input.appName, updatedApp, { abortSignal: signal }).pollUntilDone({ abortSignal: signal }),
    );
  }

  public async detachVolume(input: {
    readonly userId: string;
    readonly appName: string;
    readonly deploymentId: string;
    readonly resourceId: string;
    readonly volumeName: string;
    readonly existingVolumes: readonly DeploymentVolume[];
    readonly deleteData?: boolean;
  }): Promise<void> {
    const rgName: string = this.userResourceGroup(input.userId);
    const signal: AbortSignal = this.operationSignal();
    const app: ContainerApp = await this.clients.containerApps.get(rgName, input.appName, { abortSignal: signal });
    const existingEnvironmentId: string | undefined = app.environmentId ?? app.managedEnvironmentId;
    if (!existingEnvironmentId) throw new BuildProviderError("Existing Container App has no managed environment identity");
    const environment: ManagedEnvironment = await this.getAcaEnvironment({ userId: input.userId, environmentId: existingEnvironmentId, abortSignal: signal });

    const containers: Container[] = app.template?.containers ?? [];
    const container: Container | undefined = containers.find((c: Container): boolean => c.name === input.appName) ?? containers[0];
    if (!container) throw new BuildProviderError("Container App main container not found");

    const updatedVolumeMounts: VolumeMount[] = (container.volumeMounts ?? []).filter(
      (m: VolumeMount): boolean => m.volumeName !== input.volumeName,
    );
    const updatedVolumes: Volume[] = (app.template?.volumes ?? []).filter(
      (v: Volume): boolean => v.name !== input.volumeName,
    );

    const updatedContainers: Container[] = containers.map((c: Container): Container =>
      c.name === container.name ? { ...c, volumeMounts: updatedVolumeMounts } : c,
    );

    const updatedApp: ContainerApp = {
      location: app.location,
      tags: app.tags,
      template: {
        ...app.template,
        revisionSuffix: `unvol-${Date.now()}`,
        containers: updatedContainers,
        volumes: updatedVolumes,
      },
    };

    await runBuildStep("Container App volume detach", () =>
      this.clients.containerApps.update(rgName, input.appName, updatedApp, { abortSignal: signal }).pollUntilDone({ abortSignal: signal }),
    );

    const storageLinkName: string = this.storageLinkName(input.appName, input.volumeName);
    const envRef: ManagedEnvironmentReference = managedEnvironmentReference(environment.id!, this.requiredSetting("AZURE_SUBSCRIPTION_ID"));
    if (this.clients.managedEnvironmentsStorages) {
      try {
        await this.clients.managedEnvironmentsStorages.delete(envRef.resourceGroup, envRef.name, storageLinkName, { abortSignal: signal });
      } catch (error: unknown) {
        if (!this.isNotFound(error)) throw error;
      }
    }

    if (input.deleteData && this.clients.fileShares) {
      const storageAccountName: string = this.userStorageAccountName(input.userId);
      const shareName: string = this.volumeShareName(input.appName, input.volumeName);
      try {
        await this.clients.fileShares.delete(rgName, storageAccountName, shareName, { abortSignal: signal });
      } catch (error: unknown) {
        if (!this.isNotFound(error)) throw error;
      }
    }
  }

  public userStorageAccountName(userId: string): string {
    const sanitized: string = userId.toLowerCase().replace(/[^a-z0-9]/g, "");
    return `stkumo${sanitized.slice(0, 18).padEnd(3, "0")}`;
  }

  public volumeShareName(appName: string, volumeName: string): string {
    return `share-${appName.slice(0, 25)}-${volumeName.slice(0, 25)}`;
  }

  public storageLinkName(appName: string, volumeName: string): string {
    return `stg-${appName.slice(0, 13)}-${volumeName.slice(0, 13)}`;
  }

  private async ensureVolumeStorage(
    userId: string,
    appName: string,
    environment: ManagedEnvironment,
    volume: DeploymentVolume,
    signal?: AbortSignal,
  ): Promise<string> {
    const rgName: string = this.userResourceGroup(userId);
    const storageAccountName: string = this.userStorageAccountName(userId);
    const shareName: string = this.volumeShareName(appName, volume.name);
    const storageLinkName: string = this.storageLinkName(appName, volume.name);
    const opSignal: AbortSignal = this.operationSignal(signal);

    if (this.clients.storageAccounts && this.clients.fileShares && this.clients.managedEnvironmentsStorages) {
      let accountExists: boolean = false;
      try {
        await this.clients.storageAccounts.getProperties(rgName, storageAccountName, { abortSignal: opSignal });
        accountExists = true;
      } catch (error: unknown) {
        if (!this.isNotFound(error)) throw error;
      }
      if (!accountExists) {
        await runBuildStep("Storage Account creation", () =>
          this.clients.storageAccounts!.create(rgName, storageAccountName, {
            location: normalizeAzureRegion(environment.location),
            sku: { name: "StandardV2_LRS" },
            kind: "FileStorage",
            minimumTlsVersion: "TLS1_2",
          }, { abortSignal: opSignal }).pollUntilDone({ abortSignal: opSignal }),
        );
      }

      await runBuildStep("File share creation", () =>
        this.clients.fileShares!.create(rgName, storageAccountName, shareName, {
          shareQuota: volume.sizeGb,
        }, { abortSignal: opSignal }),
      );

      const envRef: ManagedEnvironmentReference = managedEnvironmentReference(environment.id!, this.requiredSetting("AZURE_SUBSCRIPTION_ID"));
      const storageResourceId: string = `${environment.id}/storages/${storageLinkName}`;

      if (this.clients.resources?.createOrUpdateById) {
        await runBuildStep("Managed environment storage link registration", () =>
          this.clients.resources!.createOrUpdateById!(storageResourceId, "2026-03-02-preview", {
            properties: {
              azureFile: {
                accountName: storageAccountName,
                shareName,
                accessMode: volume.accessMode ?? "ReadWrite",
                identity: "system",
              },
            },
          }, { abortSignal: opSignal }),
        );
      } else if (this.clients.managedEnvironmentsStorages) {
        await runBuildStep("Managed environment storage link registration", () =>
          this.clients.managedEnvironmentsStorages!.createOrUpdate(envRef.resourceGroup, envRef.name, storageLinkName, {
            properties: {
              azureFile: {
                accountName: storageAccountName,
                shareName,
                accessMode: volume.accessMode ?? "ReadWrite",
                identity: "system",
              } as unknown as AzureFileProperties,
            },
          }, { abortSignal: opSignal }),
        );
      }
    }

    return storageLinkName;
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
  }

  private requiredSetting(name: string): string {
    const value: unknown = this.config.get<unknown>(name);
    if (typeof value !== "string" || !value.trim()) throw new BuildProviderError(`Missing required deployment setting: ${name}`);
    return value.trim();
  }
}
