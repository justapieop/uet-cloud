import type { AzureFileProperties, ContainerApp, ContainerAppsAPIClient, ManagedEnvironmentStorage } from "@azure/arm-appcontainers";
import type { ResourceManagementClient } from "@azure/arm-resources";
import {
  BuildProviderError,
  type DeleteContainerAppInput,
  type DeleteDeploymentStorageLinksInput,
  type DeploymentResourceDeleter,
  type ResolveContainerAppEnvironmentInput,
} from "@kumo/application";
import type { DeploymentVolume } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";
import { managedEnvironmentReference, sharedEnvironmentReference, type ManagedEnvironmentReference } from "./shared-environment.js";
import { ownedContainerAppResource, userWorkloadResourceGroup } from "./workload-scope.js";
import { legacyVolumeShareName, storageLinkName, userStorageAccountName, volumeShareName } from "./volume-storage-names.js";

const ACA_STORAGE_API_VERSION: string = "2026-03-02-preview";

export interface AzureDeploymentDeleterClients {
  readonly containerApps: Pick<ContainerAppsAPIClient["containerApps"], "get" | "delete">;
  readonly managedEnvironmentsStorages: Pick<ContainerAppsAPIClient["managedEnvironmentsStorages"], "get" | "delete">;
  readonly resources?: Pick<ResourceManagementClient["resources"], "deleteById">;
}

interface ContainerAppTarget {
  readonly resourceGroup: string;
  readonly resourceId: string;
}

@Injectable()
export class AzureDeploymentDeleter implements DeploymentResourceDeleter {
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;

  public constructor(
    private readonly config: ConfigService,
    private readonly clients: AzureDeploymentDeleterClients,
  ) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
      throw new BuildProviderError("Deployment timeout must be a positive integer no greater than 2147483647");
    }
  }

  public async resolveContainerAppEnvironmentId(input: ResolveContainerAppEnvironmentInput): Promise<string | null> {
    const target: ContainerAppTarget = this.target(input);
    const app: ContainerApp | null = await this.getOwnedApp(input, target);
    if (!app) return null;
    const environmentId: string | undefined = app.environmentId ?? app.managedEnvironmentId;
    if (!environmentId) throw new BuildProviderError("Owned Container App has no managed environment identity");
    return this.allowedEnvironmentReference(environmentId, input.userId).id;
  }

  public async deleteContainerApp(input: DeleteContainerAppInput): Promise<void> {
    const target: ContainerAppTarget = this.target(input);
    const app: ContainerApp | null = await this.getOwnedApp(input, target);
    if (!app) return;

    const environmentId: string | undefined = app.environmentId ?? app.managedEnvironmentId;
    if (!environmentId) throw new BuildProviderError("Owned Container App has no managed environment identity");
    const environment: ManagedEnvironmentReference = this.allowedEnvironmentReference(environmentId, input.userId);
    if (input.environmentId && environment.id.toLowerCase() !== input.environmentId.toLowerCase()) {
      throw new BuildProviderError("Container App managed environment changed before deletion");
    }

    const signal: AbortSignal = AbortSignal.timeout(this.timeoutMs);
    try {
      await this.clients.containerApps.delete(target.resourceGroup, input.appName, { abortSignal: signal })
        .pollUntilDone({ abortSignal: signal });
    } catch (error: unknown) {
      if (!this.isNotFound(error)) throw new BuildProviderError("Container App deletion failed", { cause: error });
    }
  }

  public async deleteDeploymentStorageLinks(input: DeleteDeploymentStorageLinksInput): Promise<void> {
    const environments: readonly ManagedEnvironmentReference[] = input.environmentId
      ? [this.allowedEnvironmentReference(input.environmentId, input.userId)]
      : this.allowedEnvironmentReferences(input.userId);
    if (environments.length === 0) throw new BuildProviderError("No permitted managed environment is available for storage-link cleanup");
    const signal: AbortSignal = AbortSignal.timeout(this.timeoutMs);

    for (const volume of input.volumes) {
      for (const environment of environments) {
        await this.deleteStorageLink(input, volume, environment, signal);
      }
    }
  }

  private target(input: ResolveContainerAppEnvironmentInput): ContainerAppTarget {
    const expectedId: string = input.resourceId ??
      `/subscriptions/${this.subscriptionId}/resourceGroups/user-rg-${input.userId}/providers/Microsoft.App/containerApps/${input.appName}`;
    const owned: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource({
      resourceId: expectedId,
      userId: input.userId,
      appName: input.appName,
    }, this.subscriptionId, this.platformResourceGroup);
    if (!owned) throw new BuildProviderError("Container App resource is outside the deployment owner's workload scope");
    return owned;
  }

  private async getOwnedApp(input: ResolveContainerAppEnvironmentInput, target: ContainerAppTarget): Promise<ContainerApp | null> {
    let app: ContainerApp;
    try {
      app = await this.clients.containerApps.get(target.resourceGroup, input.appName, { abortSignal: AbortSignal.timeout(15_000) });
    } catch (error: unknown) {
      if (this.isNotFound(error)) return null;
      throw new BuildProviderError("Container App ownership lookup failed", { cause: error });
    }

    if (app.id?.toLowerCase() !== target.resourceId.toLowerCase() || app.tags?.["kumo-deployment-id"] !== input.deploymentId) {
      throw new BuildProviderError("Container App identity or deployment ownership tag does not match the SQL record");
    }
    return app;
  }

  private allowedEnvironmentReference(environmentId: string, userId: string): ManagedEnvironmentReference {
    const parsed: ManagedEnvironmentReference = managedEnvironmentReference(environmentId, this.subscriptionId);
    const match: ManagedEnvironmentReference | undefined = this.allowedEnvironmentReferences(userId)
      .find((candidate: ManagedEnvironmentReference): boolean => candidate.id.toLowerCase() === parsed.id.toLowerCase());
    if (!match) throw new BuildProviderError("Container App environment is outside the user's allowed workload environments");
    return match;
  }

  private allowedEnvironmentReferences(userId: string): ManagedEnvironmentReference[] {
    const userGroup: string | null = userWorkloadResourceGroup(userId, this.platformResourceGroup);
    if (!userGroup) throw new BuildProviderError("A valid user workload resource group is required");

    const references: ManagedEnvironmentReference[] = [managedEnvironmentReference(
      `/subscriptions/${this.subscriptionId}/resourceGroups/${userGroup}/providers/Microsoft.App/managedEnvironments/user-aca-env-${userId}`,
      this.subscriptionId,
    )];
    const sharedName: unknown = this.config.get<unknown>("AZURE_SHARED_ENVIRONMENT_NAME");
    if (typeof sharedName === "string" && /^[a-z0-9-]+$/i.test(sharedName.trim())) {
      try {
        const shared: ManagedEnvironmentReference = sharedEnvironmentReference(this.config);
        if (!references.some((reference: ManagedEnvironmentReference): boolean => reference.id.toLowerCase() === shared.id.toLowerCase())) {
          references.push(shared);
        }
      } catch {
        // A malformed shared-environment setting cannot authorize cleanup in another resource scope.
      }
    }
    return references;
  }

  private async deleteStorageLink(
    input: DeleteDeploymentStorageLinksInput,
    volume: DeploymentVolume,
    environment: ManagedEnvironmentReference,
    signal: AbortSignal,
  ): Promise<void> {
    const linkName: string = storageLinkName(input.appName, volume.name);
    const expectedAccount: string = userStorageAccountName(input.userId);
    const expectedShares: readonly string[] = [volumeShareName(volume.name), legacyVolumeShareName(input.appName, volume.name)];
    let link: ManagedEnvironmentStorage;
    try {
      link = await this.clients.managedEnvironmentsStorages.get(environment.resourceGroup, environment.name, linkName, { abortSignal: signal });
    } catch (error: unknown) {
      if (this.isNotFound(error)) return;
      throw new BuildProviderError("Managed environment storage-link lookup failed", { cause: error });
    }

    const azureFile: AzureFileProperties | undefined = link.properties?.azureFile;
    if (!azureFile || azureFile.accountName?.toLowerCase() !== expectedAccount.toLowerCase() ||
      !expectedShares.some((shareName: string): boolean => shareName.toLowerCase() === azureFile.shareName?.toLowerCase())) {
      throw new BuildProviderError("Managed environment storage link does not match the deployment's user volume");
    }

    const resourceId: string = `${environment.id}/storages/${linkName}`;
    const maxAttempts: number = 3;
    for (let attempt: number = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        try {
          await this.clients.managedEnvironmentsStorages.delete(environment.resourceGroup, environment.name, linkName, { abortSignal: signal });
        } catch (error: unknown) {
          if (!this.isNotFound(error)) throw error;
        }
        if (this.clients.resources) {
          try {
            await this.clients.resources.deleteById(resourceId, ACA_STORAGE_API_VERSION, { abortSignal: signal })
              .pollUntilDone({ abortSignal: signal });
          } catch (error: unknown) {
            if (!this.isNotFound(error)) throw error;
          }
        }
        return;
      } catch (error: unknown) {
        if (this.isNotFound(error)) return;
        if (this.isStorageInUse(error) && attempt < maxAttempts) {
          await delay(2_000 * attempt, undefined, { signal });
          continue;
        }
        throw new BuildProviderError("Managed environment storage-link deletion failed", { cause: error });
      }
    }
  }

  private isStorageInUse(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const code: unknown = "code" in error ? error.code : undefined;
    const message: unknown = "message" in error ? error.message : undefined;
    const description: string = `${typeof code === "string" ? code : ""} ${typeof message === "string" ? message : ""}`.toLowerCase();
    return description.includes("managedenvironmentstoragedeleteinuse") || description.includes("storageinuse") || description.includes("still in use");
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
  }
}
