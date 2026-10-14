import { ContainerAppsAPIClient, type ManagedEnvironment } from "@azure/arm-appcontainers";
import { ResourceManagementClient, type ResourceGroup } from "@azure/arm-resources";
import { DefaultAzureCredential } from "@azure/identity";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { AzureRegions, DEFAULT_REGION } from "./region.js";

const RG_PREFIX: string = "user-rg-";
const ACA_ENV_PREFIX: string = "user-aca-env-";
const ACA_USER_CONT_PREFIX: string = "user-aca-cont-";

export interface AzureRgInput {
  userId: string;
  region?: AzureRegions;
}

export interface AzureAcaEnvInput {
  userId: string;
  region?: AzureRegions;
}

export interface AzureDeploymentCreateInput {
  name: string;
  userId: string;
  region?: AzureRegions;
}

@Injectable()
export class AzureProvider {
  private readonly resourceManager: ResourceManagementClient;
  private readonly acaManager: ContainerAppsAPIClient;

  public constructor(configService: ConfigService) {
    const credentials: DefaultAzureCredential = new DefaultAzureCredential();

    const subscriptionId: string = configService.getOrThrow("AZURE_SUBSCRIPTION_ID");

    this.resourceManager = new ResourceManagementClient(
      credentials,
      subscriptionId,
    );

    this.acaManager = new ContainerAppsAPIClient(
      credentials,
      subscriptionId,
    );
  }

  public async getUserRg(input: AzureRgInput): Promise<ResourceGroup> {
    const rgName: string = `${RG_PREFIX}${input.userId}`;
    const exists: boolean = (await this.resourceManager.resourceGroups.checkExistence(rgName)).body.valueOf();

    if (exists) {
      return await this.resourceManager.resourceGroups.get(rgName);
    }

    return await this.resourceManager.resourceGroups.createOrUpdate(rgName, { location: input.region ?? DEFAULT_REGION, });
  }

  public async getAcaEnvironment(input: AzureAcaEnvInput): Promise<ManagedEnvironment> {
    const rgName: string = `${RG_PREFIX}${input.userId}`;
    const acaEnvName: string = `${ACA_ENV_PREFIX}${input.userId}`;
    return await this.acaManager.managedEnvironments.createOrUpdate(rgName, acaEnvName, { location: input.region ?? DEFAULT_REGION, });
  }
}