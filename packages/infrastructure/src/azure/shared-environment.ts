import { BuildProviderError } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import { normalizeAzureRegion } from "./region.js";

export interface ManagedEnvironmentReference {
  readonly id: string;
  readonly resourceGroup: string;
  readonly name: string;
}

export function managedEnvironmentReference(id: string, subscriptionId: string): ManagedEnvironmentReference {
  const match: RegExpMatchArray | null = id.match(/^\/subscriptions\/([a-z0-9-]+)\/resourceGroups\/([a-z0-9_.()-]+)\/providers\/Microsoft\.App\/managedEnvironments\/([a-z0-9-]+)$/i);
  if (!match || match[1]!.toLowerCase() !== subscriptionId.toLowerCase()) {
    throw new BuildProviderError("A managed environment resource ID in the configured subscription is required");
  }
  return { id, resourceGroup: match[2]!, name: match[3]! };
}

export function sharedEnvironmentReference(config: ConfigService): ManagedEnvironmentReference {
  const name: unknown = config.get<unknown>("AZURE_SHARED_ENVIRONMENT_NAME");
  if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) {
    throw new BuildProviderError("A managed environment name is required: AZURE_SHARED_ENVIRONMENT_NAME");
  }
  const group: unknown = config.get<unknown>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.get<unknown>("AZURE_RG_NAME");
  if (typeof group !== "string" || !/^[a-z0-9_.()-]+$/i.test(group.trim())) {
    throw new BuildProviderError("A platform resource group is required: AZURE_PLATFORM_RESOURCE_GROUP or AZURE_RG_NAME");
  }
  const subscription: string = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
  return managedEnvironmentReference(`/subscriptions/${subscription}/resourceGroups/${group.trim()}/providers/Microsoft.App/managedEnvironments/${name.trim()}`, subscription);
}

export function validateEnvironment(
  environment: { readonly id?: unknown; readonly location?: unknown; readonly environmentMode?: unknown; readonly workloadProfiles?: unknown },
  reference: ManagedEnvironmentReference, requireConsumptionProfile: boolean = true,
): string {
  if (typeof environment.id !== "string" || environment.id.toLowerCase() !== reference.id.toLowerCase() ||
    typeof environment.location !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(normalizeAzureRegion(environment.location))) {
    throw new BuildProviderError("Managed environment identity or region does not match the configured resource");
  }
  if (environment.environmentMode === "Express") throw new BuildProviderError("Kumo requires a standard Workload Profiles environment, not Express mode");
  if (requireConsumptionProfile && (!Array.isArray(environment.workloadProfiles) || !environment.workloadProfiles.some((profile: unknown): boolean =>
    typeof profile === "object" && profile !== null && "workloadProfileType" in profile && profile.workloadProfileType === "Consumption" &&
    "name" in profile && typeof profile.name === "string" && profile.name.trim().length > 0))) {
    throw new BuildProviderError("The shared managed environment requires an existing Consumption workload profile");
  }
  return normalizeAzureRegion(environment.location);
}
