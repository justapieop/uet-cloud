import type { ContainerApp, ContainerAppsAPIClient, Container, Ingress, IngressPortMapping } from "@azure/arm-appcontainers";
import { DeploymentConfigurationReadError, type DeploymentConfiguration, type DeploymentConfigurationReader } from "@kumo/application";
import type { DeploymentPortMapping } from "@kumo/domain";
import { ResilienceError } from "@nestjs/resilience";
import type { ConfigService } from "@nestjs/config";
import { normalizeAzureRegion } from "./region.js";
import { ownedContainerAppResource } from "./workload-scope.js";

export class AzureDeploymentConfigurationReader implements DeploymentConfigurationReader {
  private readonly subscriptionId: string;
  private readonly platformResourceGroup: string;

  public constructor(config: ConfigService, private readonly apps: Pick<ContainerAppsAPIClient["containerApps"], "get">) {
    this.subscriptionId = config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID");
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
  }

  public async read(input: Parameters<DeploymentConfigurationReader["read"]>[0]): Promise<DeploymentConfiguration> {
    const resource: ReturnType<typeof ownedContainerAppResource> = ownedContainerAppResource(input, this.subscriptionId, this.platformResourceGroup);
    if (!resource) throw new DeploymentConfigurationReadError("invalid");
    let app: ContainerApp;
    try {
      app = await this.apps.get(resource.resourceGroup, input.appName, { abortSignal: AbortSignal.timeout(15_000) });
    } catch (error: unknown) {
      if (error instanceof ResilienceError) throw error;
      const status: unknown = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
      throw new DeploymentConfigurationReadError(status === 404 ? "missing" : status === 403 ? "invalid" : "unavailable");
    }
    if (app.id?.toLowerCase() !== resource.resourceId.toLowerCase() || app.tags?.["kumo-deployment-id"] !== input.deploymentId || !app.location) {
      throw new DeploymentConfigurationReadError("invalid");
    }
    const containers: Container[] = app.template?.containers ?? [];
    const container: Container | undefined = containers.find((item: Container): boolean => item.name === input.appName)
      ?? (containers.length === 1 ? containers[0] : undefined);
    if (!container) throw new DeploymentConfigurationReadError("invalid");
    const ingress: Ingress | undefined = app.configuration?.ingress;
    if (ingress?.external !== undefined && typeof ingress.external !== "boolean") throw new DeploymentConfigurationReadError("invalid");
    return {
      region: normalizeAzureRegion(app.location),
      maxVcpu: this.number(container.resources?.cpu),
      maxMemory: this.memoryGiB(container.resources?.memory),
      minScaling: this.number(app.template?.scale?.minReplicas),
      maxScaling: this.number(app.template?.scale?.maxReplicas),
      targetPort: this.number(ingress?.targetPort),
      external: ingress?.external ?? null,
      additionalPorts: (ingress?.additionalPortMappings ?? []).map((port: IngressPortMapping): DeploymentPortMapping => ({
        targetPort: port.targetPort, exposedPort: port.exposedPort ?? port.targetPort, external: port.external ?? false,
      })),
      image: container.image ?? null,
      fqdn: ingress?.fqdn ?? null,
    };
  }

  private number(value: number | undefined): number | null {
    if (value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) throw new DeploymentConfigurationReadError("invalid");
    return value;
  }

  private memoryGiB(value: string | undefined): number | null {
    if (value === undefined) return null;
    const match: RegExpMatchArray | null = value.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)$/);
    if (!match) throw new DeploymentConfigurationReadError("invalid");
    const factors: Record<string, number> = { Ki: 1 / 1048576, Mi: 1 / 1024, Gi: 1, Ti: 1024 };
    const memory: number = Number(match[1]) * factors[match[2]!]!;
    if (!Number.isFinite(memory) || memory <= 0) throw new DeploymentConfigurationReadError("invalid");
    return memory;
  }
}
