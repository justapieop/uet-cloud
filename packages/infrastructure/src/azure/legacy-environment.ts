import type { ContainerAppsAPIClient, ManagedEnvironment } from "@azure/arm-appcontainers";
import type { ResourceManagementClient, ResourceGroup } from "@azure/arm-resources";
import type { Delegation, NetworkManagementClient, Subnet, VirtualNetwork } from "@azure/arm-network";
import { BuildProviderError } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";
import { legacyProvisioningEnabled } from "../feature-flags/legacy-provisioning.js";
import type { FeatureFlagConfiguration } from "../feature-flags/provider.js";
import { normalizeAzureRegion } from "./region.js";
import { describeBuildFailure, runBuildStep } from "../build-errors.js";
import { userWorkloadResourceGroup } from "./workload-scope.js";

const ACA_ENV_PREFIX: string = "user-aca-env-";
const VNET_PREFIX: string = "user-vnet-";
const ACA_SUBNET_NAME: string = "aca-infrastructure";

export interface AzureRgInput { userId: string; region?: string; abortSignal?: AbortSignal; }
export interface AzureAcaEnvInput extends AzureRgInput { requireExisting?: boolean; }

export interface LegacyEnvironmentClients {
  resourceGroups: Pick<ResourceManagementClient["resourceGroups"], "checkExistence" | "get" | "createOrUpdate">;
  managedEnvironments: Pick<ContainerAppsAPIClient["managedEnvironments"], "get" | "createOrUpdate">;
  virtualNetworks: Pick<NetworkManagementClient["virtualNetworks"], "get" | "createOrUpdate">;
}

/** Preserved per-user resource creation. Disabled unless explicitly enabled. */
export class AzureLegacyEnvironmentProvisioner {
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(private readonly config: ConfigService, private readonly clients: LegacyEnvironmentClients, private readonly featureFlags: FeatureFlagConfiguration) {
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    this.pollIntervalMs = Number(config.get<string>("AZURE_DEPLOYMENT_POLL_INTERVAL_MS", "5000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0 || this.pollIntervalMs > this.timeoutMs) {
      throw new BuildProviderError("Invalid legacy provisioning timeout or polling interval");
    }
  }

  private defaultRegion(): string {
    const region: string = this.requiredSetting("AZURE_LEGACY_DEFAULT_REGION");
    if (!/^[a-z][a-z0-9]{0,63}$/.test(region)) throw new BuildProviderError("AZURE_LEGACY_DEFAULT_REGION must be a lowercase Azure region name");
    return region;
  }

  private async getUserRg(input: AzureRgInput): Promise<ResourceGroup> {
    if (input.region !== undefined && (typeof input.region !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(input.region))) {
      throw new BuildProviderError("Region must be a lowercase Azure region name such as japaneast");
    }
    const rgName: string = this.userResourceGroup(input.userId);
    const exists: boolean = (await runBuildStep("Resource group existence check", () => this.clients.resourceGroups.checkExistence(rgName, { abortSignal: input.abortSignal }))).body;

    if (exists) {
      return runBuildStep("Resource group lookup", () => this.clients.resourceGroups.get(rgName, { abortSignal: input.abortSignal }));
    }

    return runBuildStep("Resource group creation", () => this.clients.resourceGroups.createOrUpdate(rgName, { location: input.region ?? this.defaultRegion() }, { abortSignal: input.abortSignal }));
  }

  public async getAcaEnvironment(input: AzureAcaEnvInput): Promise<ManagedEnvironment> {
    if (!legacyProvisioningEnabled(this.featureFlags)) throw new BuildProviderError("Legacy resource creation is disabled");
    const rg: ResourceGroup = input.requireExisting
      ? await runBuildStep("Resource group lookup", () => this.clients.resourceGroups.get(this.userResourceGroup(input.userId), { abortSignal: input.abortSignal }))
      : await this.getUserRg(input);
    const rgName: string = this.userResourceGroup(input.userId);
    const acaEnvName: string = `${ACA_ENV_PREFIX}${input.userId}`;
    const signal: AbortSignal = this.operationSignal(input.abortSignal);
    let environment: ManagedEnvironment;
    try {
      environment = await this.clients.managedEnvironments.get(rgName, acaEnvName, { abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw new BuildProviderError(`Managed environment lookup failed (${describeBuildFailure(error)})`, { cause: error });
      if (input.requireExisting) throw new BuildProviderError("The existing managed environment is missing; redeployment will not recreate it");
      const location: string = input.region ?? normalizeAzureRegion(rg.location);
      const subnetId: string = await this.getUserInfrastructureSubnet(input.userId, location, signal);
      environment = await runBuildStep("Managed environment creation", () => this.clients.managedEnvironments.createOrUpdate(rgName, acaEnvName, {
        location,
        environmentMode: "WorkloadProfiles",
        workloadProfiles: [{ name: "Consumption", workloadProfileType: "Consumption" }],
        vnetConfiguration: { infrastructureSubnetId: subnetId, internal: false },
      }, { abortSignal: signal }).pollUntilDone({ abortSignal: signal }));
    }
    if (input.region && normalizeAzureRegion(environment.location) !== normalizeAzureRegion(input.region)) {
      throw new BuildProviderError(`The user's shared managed environment is in ${environment.location}; requested region ${input.region} cannot be used`);
    }
    if (environment.environmentMode === "Express") {
      throw new BuildProviderError("The user's shared managed environment uses Express mode. Kumo requires a standard Workload Profiles environment. Replace or migrate the environment before submitting another deployment; changing the app name does not change the shared environment");
    }
    while (environment.provisioningState !== "Succeeded") {
      if (!environment.provisioningState || ["Failed", "Canceled", "Deleting"].includes(environment.provisioningState)) {
        throw new BuildProviderError(`Managed environment ${acaEnvName} is not ready: ${environment.provisioningState ?? "unknown state"}`);
      }
      await delay(this.pollIntervalMs, undefined, { signal });
      environment = await runBuildStep("Managed environment readiness check", () => this.clients.managedEnvironments.get(rgName, acaEnvName, { abortSignal: signal }));
    }
    const expectedId: string = `/subscriptions/${this.requiredSetting("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${rgName}/providers/Microsoft.App/managedEnvironments/${acaEnvName}`;
    if (environment.id?.toLowerCase() !== expectedId.toLowerCase()) {
      throw new BuildProviderError("Managed environment is missing its resource ID");
    }
    return environment;
  }

  private async getUserInfrastructureSubnet(userId: string, location: string, signal: AbortSignal): Promise<string> {
    const rgName: string = this.userResourceGroup(userId);
    const vnetName: string = `${VNET_PREFIX}${userId}`;
    const vnetId: string = `/subscriptions/${this.requiredSetting("AZURE_SUBSCRIPTION_ID")}/resourceGroups/${rgName}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
    const subnetId: string = `${vnetId}/subnets/${ACA_SUBNET_NAME}`;
    let network: VirtualNetwork;
    try {
      network = await this.clients.virtualNetworks.get(rgName, vnetName, { abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw new BuildProviderError(`Virtual network lookup failed (${describeBuildFailure(error)})`, { cause: error });
      network = await runBuildStep("Virtual network creation", () => this.clients.virtualNetworks.createOrUpdate(rgName, vnetName, {
        location,
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ name: ACA_SUBNET_NAME, addressPrefix: "10.0.0.0/24",
          delegations: [{ name: "container-apps", serviceName: "Microsoft.App/environments" }] }],
      }, { abortSignal: signal }).pollUntilDone({ abortSignal: signal }));
    }
    if (network.id?.toLowerCase() !== vnetId.toLowerCase() || typeof network.location !== "string" || normalizeAzureRegion(network.location) !== location) {
      throw new BuildProviderError("The user's virtual network identity or region does not match the requested workload scope");
    }
    while (network.provisioningState !== "Succeeded") {
      if (!network.provisioningState || ["Failed", "Canceled", "Deleting"].includes(network.provisioningState)) {
        throw new BuildProviderError(`Virtual network ${vnetName} is not ready: ${network.provisioningState ?? "unknown state"}`);
      }
      await delay(this.pollIntervalMs, undefined, { signal });
      network = await runBuildStep("Virtual network readiness check", () => this.clients.virtualNetworks.get(rgName, vnetName, { abortSignal: signal }));
    }
    const subnet: Subnet | undefined = network.subnets?.find((candidate: Subnet): boolean => candidate.name === ACA_SUBNET_NAME);
    const prefix: string | undefined = subnet?.addressPrefix ?? (subnet?.addressPrefixes?.length === 1 ? subnet.addressPrefixes[0] : undefined);
    const prefixLength: number = Number(prefix?.split("/")[1]);
    if (network.id?.toLowerCase() !== vnetId.toLowerCase() || typeof network.location !== "string" || normalizeAzureRegion(network.location) !== location ||
      subnet?.id?.toLowerCase() !== subnetId.toLowerCase() || subnet.provisioningState !== "Succeeded" ||
      !prefix || !/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(prefix) || prefixLength < 0 || prefixLength > 27 ||
      !subnet.delegations?.some((delegation: Delegation): boolean => delegation.serviceName?.toLowerCase() === "microsoft.app/environments")) {
      throw new BuildProviderError("The user's virtual network requires a ready dedicated aca-infrastructure subnet (/27 or larger) delegated to Microsoft.App/environments; existing networking was not modified");
    }
    signal.throwIfAborted();
    return subnetId;
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

  private isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
  }

  private requiredSetting(name: string): string {
    const value: unknown = this.config.get<unknown>(name);
    if (typeof value !== "string" || !value.trim()) throw new BuildProviderError(`Missing required deployment setting: ${name}`);
    return value.trim();
  }
}
