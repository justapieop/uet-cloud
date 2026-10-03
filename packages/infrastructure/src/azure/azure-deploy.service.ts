import { ContainerAppsAPIClient, type EnvironmentVar } from "@azure/arm-appcontainers";
import { ResourceManagementClient } from "@azure/arm-resources";
import { DefaultAzureCredential } from "@azure/identity";
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AzureDeployPort,
  DeployAppParams,
  UpdateAppParams,
} from "@kumo/application";

const FORBIDDEN_RESOURCE_GROUP: string = "int3319-test";
const DEFAULT_LOCATION: string = "eastasia";
const DEFAULT_CPU: number = 0.25;
const DEFAULT_MEMORY: string = "0.5Gi";
const DEFAULT_MIN_REPLICAS: number = 0;
const DEFAULT_MAX_REPLICAS: number = 2;

@Injectable()
export class AzureDeployService implements AzureDeployPort {
  private readonly resourceClient: ResourceManagementClient;
  private readonly containerAppsClient: ContainerAppsAPIClient;
  private readonly managedEnvironmentId: string;
  private readonly location: string;

  public constructor(@Optional() configService?: ConfigService) {
    const credential: DefaultAzureCredential = new DefaultAzureCredential();

    const envManagedEnvId: string | undefined =
      configService?.get<string>("AZURE_CONTAINER_APP_ENV_ID") ??
      process.env.AZURE_CONTAINER_APP_ENV_ID;

    this.managedEnvironmentId = envManagedEnvId ?? "";

    // Extract subscriptionId from AZURE_SUBSCRIPTION_ID or from managedEnvironmentId resource URI
    let subscriptionId: string | undefined =
      configService?.get<string>("AZURE_SUBSCRIPTION_ID") ??
      process.env.AZURE_SUBSCRIPTION_ID;

    if (!subscriptionId && this.managedEnvironmentId) {
      const match: RegExpMatchArray | null = this.managedEnvironmentId.match(
        /\/subscriptions\/([^/]+)\//i,
      );
      if (match && match[1]) {
        subscriptionId = match[1];
      }
    }

    const resolvedSubscriptionId: string = subscriptionId ?? "";

    this.location =
      configService?.get<string>("AZURE_LOCATION") ??
      process.env.AZURE_LOCATION ??
      DEFAULT_LOCATION;

    this.resourceClient = new ResourceManagementClient(
      credential,
      resolvedSubscriptionId,
    );
    this.containerAppsClient = new ContainerAppsAPIClient(
      credential,
      resolvedSubscriptionId,
    );
  }

  public async ensureUserResourceGroup(userId: string): Promise<string> {
    const sanitizedUserId: string = userId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");

    const resourceGroupName: string = `user-rg-${sanitizedUserId}`;

    if (
      resourceGroupName === FORBIDDEN_RESOURCE_GROUP ||
      resourceGroupName === `user-rg-${FORBIDDEN_RESOURCE_GROUP}`
    ) {
      throw new Error(
        `Forbidden: cannot operate on system resource group ${FORBIDDEN_RESOURCE_GROUP}`,
      );
    }

    const existsResult = await this.resourceClient.resourceGroups.checkExistence(
      resourceGroupName,
    );

    const exists: boolean =
      typeof existsResult === "boolean"
        ? existsResult
      : (existsResult as { body?: boolean })?.body === true;

    if (!exists) {
      await this.resourceClient.resourceGroups.createOrUpdate(
        resourceGroupName,
        {
          location: this.location,
          tags: {
            owner: userId,
            managedBy: "kumo-paas",
          },
        },
      );
    }

    return resourceGroupName;
  }

  public async deployContainerApp(
    params: DeployAppParams,
  ): Promise<{ fqdn: string }> {
    if (!this.managedEnvironmentId) {
      throw new Error(
        "AZURE_CONTAINER_APP_ENV_ID is not configured. Please set it in environment variables.",
      );
    }

    const envVarsList: EnvironmentVar[] = params.spec.envVars
      ? Object.entries(params.spec.envVars).map(
          ([name, value]: [string, string]): EnvironmentVar => ({
            name,
            value,
          }),
        )
      : [];

    const cpuVal: number = params.spec.resources?.cpu
      ? Number(params.spec.resources.cpu)
      : DEFAULT_CPU;
    const memoryVal: string =
      params.spec.resources?.memory ?? DEFAULT_MEMORY;
    const minReplicas: number =
      params.spec.scaling?.minReplicas ?? DEFAULT_MIN_REPLICAS;
    const maxReplicas: number =
      params.spec.scaling?.maxReplicas ?? DEFAULT_MAX_REPLICAS;

    const result = await this.containerAppsClient.containerApps.beginCreateOrUpdateAndWait(
      params.resourceGroupName,
      params.appName,
      {
        location: this.location,
        managedEnvironmentId: this.managedEnvironmentId,
        configuration: {
          ingress: {
            external: true,
            targetPort: params.spec.targetPort,
            transport: "Auto",
            allowInsecure: false,
          },
        },
        template: {
          containers: [
            {
              name: params.appName,
              image: params.spec.image,
              resources: {
                cpu: cpuVal,
                memory: memoryVal,
              },
              env: envVarsList.length > 0 ? envVarsList : undefined,
            },
          ],
          scale: {
            minReplicas,
            maxReplicas,
          },
        },
      },
    );

    const fqdn: string | undefined = result.configuration?.ingress?.fqdn;
    const url: string = fqdn ? `https://${fqdn}` : "";

    return { fqdn: url };
  }

  public async updateContainerApp(
    params: UpdateAppParams,
  ): Promise<{ fqdn: string }> {
    const existing = await this.containerAppsClient.containerApps.get(
      params.resourceGroupName,
      params.appName,
    );

    const existingContainer = existing.template?.containers?.[0];
    const imageToUse: string = params.spec.image ?? existingContainer?.image ?? "";
    const targetPortToUse: number =
      params.spec.targetPort ?? existing.configuration?.ingress?.targetPort ?? 80;

    const envVarsList: EnvironmentVar[] = params.spec.envVars
      ? Object.entries(params.spec.envVars).map(
          ([name, value]: [string, string]): EnvironmentVar => ({
            name,
            value,
          }),
        )
      : existingContainer?.env ?? [];

    const cpuToUse: number = params.spec.resources?.cpu
      ? Number(params.spec.resources.cpu)
      : (existingContainer?.resources?.cpu ?? DEFAULT_CPU);
    const memoryToUse: string =
      params.spec.resources?.memory ?? existingContainer?.resources?.memory ?? DEFAULT_MEMORY;

    const minReplicas: number =
      params.spec.scaling?.minReplicas ??
      existing.template?.scale?.minReplicas ??
      DEFAULT_MIN_REPLICAS;
    const maxReplicas: number =
      params.spec.scaling?.maxReplicas ??
      existing.template?.scale?.maxReplicas ??
      DEFAULT_MAX_REPLICAS;

    const result = await this.containerAppsClient.containerApps.beginCreateOrUpdateAndWait(
      params.resourceGroupName,
      params.appName,
      {
        location: existing.location,
        managedEnvironmentId: existing.managedEnvironmentId,
        configuration: {
          ...existing.configuration,
          ingress: {
            ...existing.configuration?.ingress,
            external: true,
            targetPort: targetPortToUse,
            transport: "Auto",
          },
        },
        template: {
          ...existing.template,
          containers: [
            {
              name: params.appName,
              image: imageToUse,
              resources: {
                cpu: cpuToUse,
                memory: memoryToUse,
              },
              env: envVarsList.length > 0 ? envVarsList : undefined,
            },
          ],
          scale: {
            minReplicas,
            maxReplicas,
          },
        },
      },
    );

    const fqdn: string | undefined = result.configuration?.ingress?.fqdn;
    const url: string = fqdn ? `https://${fqdn}` : "";

    return { fqdn: url };
  }
}
