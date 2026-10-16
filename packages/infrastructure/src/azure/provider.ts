import { ContainerAppsAPIClient, type ContainerApp, type ContainerResources, type EnvironmentVar, type ManagedEnvironment } from "@azure/arm-appcontainers";
import { ResourceManagementClient, type ResourceGroup } from "@azure/arm-resources";
import { DefaultAzureCredential } from "@azure/identity";
import { BuildProviderError, type DeploymentProvisioner, type DeploymentProvisionInput, type DeploymentProvisionResult, type GetBuildCase, type TriggerBuildCase, type TriggerBuildInput, type TriggerBuildResult } from "@kumo/application";
import { validateDeploymentPorts, type BuildDetails, type DeploymentPortMapping, type InvalidDomainParams } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";
import { AzureRegions, DEFAULT_REGION } from "./region.js";

const RG_PREFIX: string = "user-rg-";
const ACA_ENV_PREFIX: string = "user-aca-env-";

export interface AzureRgInput {
  userId: string;
  region?: AzureRegions;
  abortSignal?: AbortSignal;
}

export interface AzureAcaEnvInput extends AzureRgInput {}

export interface AzureDeploymentCreateInput extends AzureAcaEnvInput {
  name: string;
  repo: string;
  imageName?: string;
  tag: string;
  dockerFilePath?: string;
  ref?: string;
  targetPort: number;
  additionalPorts?: readonly DeploymentPortMapping[];
  resources?: ContainerResources;
  envVars?: Readonly<Record<string, string>>;
  minReplicas?: number;
  maxReplicas?: number;
  deploymentId?: string;
  onBuildAccepted?: (id: string, image: string) => Promise<void>;
}

export interface AzureProviderClients {
  resources: Pick<ResourceManagementClient["resources"], "getById">;
  resourceGroups: Pick<ResourceManagementClient["resourceGroups"], "checkExistence" | "get" | "createOrUpdate">;
  managedEnvironments: Pick<ContainerAppsAPIClient["managedEnvironments"], "get" | "createOrUpdate">;
  containerApps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "createOrUpdate">;
}

@Injectable()
export class AzureProvider implements DeploymentProvisioner {
  private readonly clients: AzureProviderClients;
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(
    private readonly config: ConfigService,
    private readonly triggerBuild: Pick<TriggerBuildCase, "exec">,
    private readonly getBuild: Pick<GetBuildCase, "exec">,
    clients?: AzureProviderClients,
  ) {
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP")
      ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    this.pollIntervalMs = Number(config.get<string>("AZURE_DEPLOYMENT_POLL_INTERVAL_MS", "5000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0 || this.pollIntervalMs > this.timeoutMs) {
      throw new Error("Deployment timeout and polling interval must be positive integers, with the interval no greater than the timeout");
    }
    if (clients) {
      this.clients = clients;
    } else {
      const credentials: DefaultAzureCredential = new DefaultAzureCredential();
      const subscriptionId: string = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
      const resourceManager: ResourceManagementClient = new ResourceManagementClient(credentials, subscriptionId);
      const acaManager: ContainerAppsAPIClient = new ContainerAppsAPIClient(credentials, subscriptionId);
      this.clients = {
        resources: resourceManager.resources,
        resourceGroups: resourceManager.resourceGroups,
        managedEnvironments: acaManager.managedEnvironments,
        containerApps: acaManager.containerApps,
      };
    }
  }

  public async getUserRg(input: AzureRgInput): Promise<ResourceGroup> {
    const rgName: string = this.userResourceGroup(input.userId);
    const exists: boolean = (await this.clients.resourceGroups.checkExistence(rgName, { abortSignal: input.abortSignal })).body;

    if (exists) {
      return this.clients.resourceGroups.get(rgName, { abortSignal: input.abortSignal });
    }

    return this.clients.resourceGroups.createOrUpdate(rgName, { location: input.region ?? DEFAULT_REGION }, { abortSignal: input.abortSignal });
  }

  public async getAcaEnvironment(input: AzureAcaEnvInput): Promise<ManagedEnvironment> {
    const rg: ResourceGroup = await this.getUserRg(input);
    const rgName: string = this.userResourceGroup(input.userId);
    const acaEnvName: string = `${ACA_ENV_PREFIX}${input.userId}`;
    const signal: AbortSignal = this.operationSignal(input.abortSignal);
    let environment: ManagedEnvironment;
    try {
      environment = await this.clients.managedEnvironments.get(rgName, acaEnvName, { abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw error;
      environment = await this.clients.managedEnvironments.createOrUpdate(rgName, acaEnvName, {
        location: input.region ?? rg.location,
        workloadProfiles: [],
      }, { abortSignal: signal }).pollUntilDone({ abortSignal: signal });
    }
    while (environment.provisioningState !== "Succeeded") {
      if (!environment.provisioningState || ["Failed", "Canceled", "Deleting"].includes(environment.provisioningState)) {
        throw new Error(`Managed environment ${acaEnvName} is not ready: ${environment.provisioningState ?? "unknown state"}`);
      }
      await delay(this.pollIntervalMs, undefined, { signal });
      environment = await this.clients.managedEnvironments.get(rgName, acaEnvName, { abortSignal: signal });
    }
    if (!environment.id || (input.region && environment.location.toLowerCase() !== input.region.toLowerCase())) {
      throw new Error("Managed environment is missing its resource ID or belongs to a different region");
    }
    return environment;
  }

  public async provisionDeployment(input: DeploymentProvisionInput, onBuildAccepted: (id: string, image: string) => Promise<void>): Promise<DeploymentProvisionResult> {
    const app: ContainerApp = await this.createDeployment({
      ...input.spec, name: input.name, userId: input.userId, deploymentId: input.id,
      resources: { cpu: input.spec.maxVcpu, memory: `${input.spec.maxMemory}Gi` },
      minReplicas: input.spec.minScaling, maxReplicas: input.spec.maxScaling, onBuildAccepted,
    });
    const buildId: string | undefined = app.tags?.["kumo-build-id"];
    const image: string | undefined = app.template?.containers?.[0]?.image;
    if (!app.id || !buildId || !image || app.provisioningState !== "Succeeded") {
      throw new Error("Azure did not return a successfully provisioned app with build metadata");
    }
    return { buildId, image, resourceId: app.id, fqdn: app.configuration?.ingress?.fqdn ?? null };
  }

  public async createDeployment(input: AzureDeploymentCreateInput): Promise<ContainerApp> {
    const portError: InvalidDomainParams | null = validateDeploymentPorts(input.targetPort, input.additionalPorts);
    if (portError) throw portError;
    const rgName: string = this.userResourceGroup(input.userId);
    if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(input.name)) {
      throw new Error("Container App name must be 2-32 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit");
    }
    if (typeof input.tag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(input.tag)) {
      throw new Error("Image tag must be 1-128 letters, digits, underscores, periods, or hyphens, starting with a letter, digit, or underscore");
    }
    const minReplicas: number = input.minReplicas ?? 0;
    const maxReplicas: number = input.maxReplicas ?? 2;
    const resources: ContainerResources = input.resources ?? { cpu: 0.25, memory: "0.5Gi" };
    const memory: number = typeof resources.memory === "string" && /^(?:\d+(?:\.\d+)?)Gi$/.test(resources.memory)
      ? Number(resources.memory.slice(0, -2)) : NaN;
    if (typeof resources.cpu !== "number" || !Number.isFinite(resources.cpu) || resources.cpu <= 0 ||
      !Number.isInteger(resources.cpu * 4) || !Number.isFinite(memory) || memory !== resources.cpu * 2) {
      throw new Error("Memory in GiB must be exactly twice vCPU; vCPU must be positive in increments of 0.25");
    }
    if (!Number.isInteger(input.targetPort) || input.targetPort < 1 || input.targetPort > 65535 ||
      !Number.isInteger(minReplicas) || minReplicas < 0 || !Number.isInteger(maxReplicas) || maxReplicas < 1 || maxReplicas < minReplicas) {
      throw new Error("Invalid container port or replica limits");
    }
    const registry: string = this.config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_SERVER");
    const pullIdentityName: string = this.config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME");
    if (!/^[a-z0-9.-]+$/i.test(registry) ||
      !/^[a-z0-9][a-z0-9_-]{2,127}$/i.test(pullIdentityName)) {
      throw new Error("A private registry hostname and valid user-assigned ACR pull identity name are required");
    }
    const pullIdentity: string = `/subscriptions/${this.config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${this.platformResourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${pullIdentityName}`;
    const signal: AbortSignal = this.operationSignal(input.abortSignal);
    const environment: ManagedEnvironment = await this.getAcaEnvironment({ ...input, abortSignal: signal });
    if (input.additionalPorts?.some((port: DeploymentPortMapping): boolean => port.external === true) && !environment.vnetConfiguration?.infrastructureSubnetId) {
      throw new BuildProviderError("External additional TCP ports require a managed environment connected to a virtual network");
    }
    let existing: ContainerApp | undefined;
    try {
      existing = await this.clients.containerApps.get(rgName, input.name, { abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw error;
    }
    if (existing) {
      if (input.deploymentId && existing.tags?.["kumo-deployment-id"] !== input.deploymentId) {
        throw new Error("An unrelated Container App already uses this deployment name");
      }
      if ((existing.environmentId ?? existing.managedEnvironmentId)?.toLowerCase() !== environment.id!.toLowerCase()) {
        throw new Error("Existing Container App does not belong to the user's managed environment");
      }
      return existing;
    }

    const registryId: string = this.config.get<string>("AZURE_CONTAINER_REGISTRY_RESOURCE_ID")
      ?? `/subscriptions/${this.config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${this.config.getOrThrow<string>("AZURE_RG_NAME")}/providers/Microsoft.ContainerRegistry/registries/${this.config.getOrThrow<string>("AZURE_CONTAINER_REGISTRY_NAME")}`;
    if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ContainerRegistry\/registries\/[^/]+$/i.test(registryId)) {
      throw new Error("A valid ACR resource ID is required");
    }
    const registryResource: { properties?: unknown } = await this.clients.resources.getById(registryId, "2023-07-01", { abortSignal: signal });
    const registryProperties: unknown = registryResource.properties;
    if (typeof registryProperties !== "object" || registryProperties === null ||
      !("loginServer" in registryProperties) || registryProperties.loginServer !== registry ||
      !("anonymousPullEnabled" in registryProperties) || registryProperties.anonymousPullEnabled !== false) {
      throw new Error("The configured ACR must match the image hostname and have anonymous pull disabled before building user images");
    }

    const buildInput: TriggerBuildInput = {
      userId: input.userId, repo: input.repo, imageName: input.imageName ?? input.name, tag: input.tag,
      dockerFilePath: input.dockerFilePath, ref: input.ref,
    };
    signal.throwIfAborted();
    const build: TriggerBuildResult = await this.triggerBuild.exec(buildInput);
    await input.onBuildAccepted?.(build.buildId, build.image);
    const completed: BuildDetails = await this.waitForBuild(build.buildId, input.userId, signal);
    if (!completed.image.startsWith(`${registry}/`)) {
      throw new Error("Build image does not belong to the configured private registry");
    }
    const env: EnvironmentVar[] = Object.entries(input.envVars ?? {}).map(
      ([name, value]: [string, string]): EnvironmentVar => ({ name, value }),
    );
    const app: ContainerApp = {
      tags: { "kumo-build-id": build.buildId, ...(input.deploymentId ? { "kumo-deployment-id": input.deploymentId } : {}) },
      location: environment.location,
      environmentId: environment.id,
      identity: { type: "UserAssigned", userAssignedIdentities: { [pullIdentity]: {} } },
      configuration: {
        activeRevisionsMode: "Single",
        ingress: {
          external: true, targetPort: input.targetPort, allowInsecure: false,
          additionalPortMappings: input.additionalPorts?.map((port: DeploymentPortMapping) => ({
            targetPort: port.targetPort, exposedPort: port.exposedPort ?? port.targetPort, external: port.external ?? false,
          })),
        },
        registries: [{ server: registry, identity: pullIdentity }],
        identitySettings: [{ identity: pullIdentity, lifecycle: "None" }],
      },
      template: {
        containers: [{ name: input.name, image: completed.image, env, resources }],
        scale: { minReplicas, maxReplicas },
      },
    };
    signal.throwIfAborted();
    return this.clients.containerApps.createOrUpdate(rgName, input.name, app, { abortSignal: signal })
      .pollUntilDone({ abortSignal: signal });
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
    if (!/^[0-9]{1,32}$/.test(userId)) throw new Error("A valid numeric GitHub user ID is required");
    const name: string = `${RG_PREFIX}${userId}`;
    if (name.toLowerCase() === this.platformResourceGroup.toLowerCase()) {
      throw new Error("User workloads cannot target the platform resource group");
    }
    return name;
  }

  private operationSignal(signal?: AbortSignal): AbortSignal {
    const timeout: AbortSignal = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
  }
}
