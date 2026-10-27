import type { DeploymentRegion, DeploymentRegionsReader } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import type { AzureCredential, HttpTransport } from "../external-clients.js";
import { legacyProvisioningEnabled } from "../feature-flags/legacy-provisioning.js";
import type { FeatureFlagConfiguration } from "../feature-flags/provider.js";
import { normalizeAzureRegion } from "./region.js";

export class AzureLegacyDeploymentRegionsReader implements DeploymentRegionsReader {
  private readonly subscriptionPath: string;

  public constructor(private readonly config: ConfigService, private readonly credential: AzureCredential, private readonly http: HttpTransport, private readonly featureFlags: FeatureFlagConfiguration) {
    this.subscriptionPath = `/subscriptions/${encodeURIComponent(config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"))}`;
  }

  public async list(): Promise<DeploymentRegion[]> {
    if (!legacyProvisioningEnabled(this.featureFlags)) throw new Error("Legacy region discovery is disabled");
    const signal: AbortSignal = AbortSignal.timeout(30_000);
    const access: Awaited<ReturnType<AzureCredential["getToken"]>> = await this.credential.getToken("https://management.azure.com/.default", { abortSignal: signal });
    if (!access?.token) throw new Error("Azure region lookup could not authenticate");
    const [locations, app, network, allowed]: [unknown[], unknown, unknown, Set<string> | null] = await Promise.all([
      this.collection(`${this.subscriptionPath}/locations`, "2022-12-01", "location", access.token, signal),
      this.json(`${this.subscriptionPath}/providers/Microsoft.App?api-version=2021-04-01`, access.token, signal),
      this.json(`${this.subscriptionPath}/providers/Microsoft.Network?api-version=2021-04-01`, access.token, signal),
      this.allowedLocations(access.token, signal),
    ]);
    const supported: Set<string>[] = [this.supportedLocations(app, "containerApps"),
      this.supportedLocations(app, "managedEnvironments"), this.supportedLocations(network, "virtualNetworks")];
    const regions: Map<string, DeploymentRegion> = new Map();
    for (let index: number = 0; index < locations.length; index++) {
      const location: unknown = locations[index];
      if (!isRecord(location) || typeof location.name !== "string" || typeof location.displayName !== "string") {
        throw new Error("Azure returned an invalid subscription location");
      }
      if (location.type !== undefined && location.type !== "Region") continue;
      if (isRecord(location.metadata) && location.metadata.regionType === "Logical") continue;
      const name: string = normalizeAzureRegion(location.name);
      const displayName: string = location.displayName.trim();
      if (!/^[a-z][a-z0-9]{0,63}$/.test(name) || !displayName) throw new Error("Azure returned an invalid region");
      if ((allowed === null || allowed.has(name)) && supported.every((names: Set<string>): boolean => names.has(name) || names.has(normalizeAzureRegion(displayName)))) {
        regions.set(name, { name, displayName });
      }
    }
    const candidates: DeploymentRegion[] = [...regions.values()].sort((left: DeploymentRegion, right: DeploymentRegion): number => left.name.localeCompare(right.name));
    const available: DeploymentRegion[] = [];
    for (let offset: number = 0; offset < candidates.length; offset += 5) {
      const batch: DeploymentRegion[] = candidates.slice(offset, offset + 5);
      const hasQuota: boolean[] = await Promise.all(batch.map((region: DeploymentRegion): Promise<boolean> =>
        this.hasEnvironmentQuota(region.name, access.token, signal)));
      for (let index: number = 0; index < batch.length; index++) {
        if (hasQuota[index]) available.push(batch[index]);
      }
    }
    return available;
  }

  private async allowedLocations(token: string, signal: AbortSignal): Promise<Set<string> | null> {
    const assignment: unknown = await this.json(
      `${this.subscriptionPath}/providers/Microsoft.Authorization/policyAssignments/sys.regionrestriction?api-version=2023-04-01`, token, signal, true);
    // Subscriptions without the system restriction retain their supported region catalog.
    if (assignment === undefined) return null;
    if (!isRecord(assignment) || !isRecord(assignment.properties)) throw new Error("Azure returned an invalid region policy");
    const properties: Record<string, unknown> = assignment.properties;
    if (properties.enforcementMode === "DoNotEnforce") return null;
    if (properties.enforcementMode !== undefined && properties.enforcementMode !== "Default") throw new Error("Azure returned an invalid region policy enforcement mode");
    const parameters: unknown = properties.parameters;
    const parameter: unknown = isRecord(parameters) ? parameters.listOfAllowedLocations : undefined;
    if (!isRecord(parameter) || !Array.isArray(parameter.value) || parameter.value.some((value: unknown): boolean =>
      typeof value !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(normalizeAzureRegion(value)))) {
      throw new Error("Azure returned invalid allowed policy locations");
    }
    return new Set(parameter.value.map((value: string): string => normalizeAzureRegion(value)));
  }

  private supportedLocations(provider: unknown, resourceType: string): Set<string> {
    if (!isRecord(provider) || !Array.isArray(provider.resourceTypes)) throw new Error("Azure returned invalid resource-provider metadata");
    const resource: unknown = provider.resourceTypes.find((entry: unknown): boolean =>
      isRecord(entry) && typeof entry.resourceType === "string" && entry.resourceType.toLowerCase() === resourceType.toLowerCase());
    if (!isRecord(resource) || !Array.isArray(resource.locations) || resource.locations.some((value: unknown): boolean => typeof value !== "string" || !value.trim())) {
      throw new Error("Azure did not report supported resource locations");
    }
    return new Set(resource.locations.map((value: string): string => normalizeAzureRegion(value)));
  }

  private async hasEnvironmentQuota(region: string, token: string, signal: AbortSignal): Promise<boolean> {
    const usages: unknown[] = await this.collection(
      `${this.subscriptionPath}/providers/Microsoft.App/locations/${encodeURIComponent(region)}/usages`, "2024-03-01", "quota", token, signal);
    const matches: unknown[] = usages.filter((entry: unknown): boolean =>
      isRecord(entry) && isRecord(entry.name) && entry.name.value === "ManagedEnvironmentCount");
    const quota: unknown = matches[0];
    if (matches.length !== 1 || !isRecord(quota) || typeof quota.currentValue !== "number" || !Number.isSafeInteger(quota.currentValue) || quota.currentValue < 0 ||
      typeof quota.limit !== "number" || !Number.isSafeInteger(quota.limit) || quota.limit < 0) {
      throw new Error("Azure returned invalid managed environment quota");
    }
    return quota.currentValue < quota.limit;
  }

  private async collection(path: string, version: string, label: string, token: string, signal: AbortSignal): Promise<unknown[]> {
    let url: URL | null = new URL(`https://management.azure.com${path}?api-version=${version}`);
    const seen: Set<string> = new Set();
    const locations: unknown[] = [];
    while (url) {
      if (url.origin !== "https://management.azure.com" || url.pathname !== path || url.username || url.password || url.hash ||
        url.searchParams.get("api-version") !== version || seen.has(url.href)) {
        throw new Error(`Azure returned invalid ${label} pagination`);
      }
      seen.add(url.href);
      const page: unknown = await this.json(url.href, token, signal);
      if (!isRecord(page) || !Array.isArray(page.value)) throw new Error(`Azure returned an invalid ${label} page`);
      locations.push(...page.value);
      if (page.nextLink !== undefined && page.nextLink !== null && typeof page.nextLink !== "string") throw new Error(`Azure returned invalid ${label} pagination`);
      url = page.nextLink ? new URL(page.nextLink as string, url) : null;
    }
    return locations;
  }

  private async json(path: string, token: string, signal: AbortSignal, allowNotFound: boolean = false): Promise<unknown> {
    const response: Response = await this.http(path.startsWith("/") ? `https://management.azure.com${path}` : path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal,
    });
    if (allowNotFound && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Azure region lookup failed: HTTP ${response.status}`);
    return response.json();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
