import type { DeploymentRegion, DeploymentRegionsReader } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import type { AzureCredential, HttpTransport } from "../external-clients.js";
import { normalizeAzureRegion } from "./region.js";

export class AzureDeploymentRegionsReader implements DeploymentRegionsReader {
  private readonly subscriptionPath: string;

  public constructor(config: ConfigService, private readonly credential: AzureCredential, private readonly http: HttpTransport) {
    this.subscriptionPath = `/subscriptions/${encodeURIComponent(config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"))}`;
  }

  public async list(): Promise<DeploymentRegion[]> {
    const signal: AbortSignal = AbortSignal.timeout(30_000);
    const access: Awaited<ReturnType<AzureCredential["getToken"]>> = await this.credential.getToken("https://management.azure.com/.default", { abortSignal: signal });
    if (!access?.token) throw new Error("Azure region lookup could not authenticate");
    const [locations, app, network]: [unknown[], unknown, unknown] = await Promise.all([
      this.locations(access.token, signal),
      this.json(`${this.subscriptionPath}/providers/Microsoft.App?api-version=2021-04-01`, access.token, signal),
      this.json(`${this.subscriptionPath}/providers/Microsoft.Network?api-version=2021-04-01`, access.token, signal),
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
      if (supported.every((names: Set<string>): boolean => names.has(name) || names.has(normalizeAzureRegion(displayName)))) {
        regions.set(name, { name, displayName });
      }
    }
    return [...regions.values()].sort((left: DeploymentRegion, right: DeploymentRegion): number => left.name.localeCompare(right.name));
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

  private async locations(token: string, signal: AbortSignal): Promise<unknown[]> {
    const path: string = `${this.subscriptionPath}/locations`;
    let url: URL | null = new URL(`https://management.azure.com${path}?api-version=2022-12-01`);
    const seen: Set<string> = new Set();
    const locations: unknown[] = [];
    while (url) {
      if (url.origin !== "https://management.azure.com" || url.pathname !== path || url.username || url.password || url.hash ||
        url.searchParams.get("api-version") !== "2022-12-01" || seen.has(url.href)) {
        throw new Error("Azure returned invalid location pagination");
      }
      seen.add(url.href);
      const page: unknown = await this.json(url.href, token, signal);
      if (!isRecord(page) || !Array.isArray(page.value)) throw new Error("Azure returned an invalid location page");
      locations.push(...page.value);
      if (page.nextLink !== undefined && page.nextLink !== null && typeof page.nextLink !== "string") throw new Error("Azure returned invalid location pagination");
      url = page.nextLink ? new URL(page.nextLink as string, url) : null;
    }
    return locations;
  }

  private async json(path: string, token: string, signal: AbortSignal): Promise<unknown> {
    const response: Response = await this.http(path.startsWith("/") ? `https://management.azure.com${path}` : path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal,
    });
    if (!response.ok) throw new Error(`Azure region lookup failed: HTTP ${response.status}`);
    return response.json();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
