import { ResilienceService } from "@nestjs/resilience";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { NetworkManagementClient } from "@azure/arm-network";
import { ResourceManagementClient } from "@azure/arm-resources";
import { StorageManagementClient } from "@azure/arm-storage";
import { Module } from "@nestjs/common";
import {
  AttachVolumeCase,
  DetachVolumeCase,
  ListVolumesCase,
  CreateDeploymentCase,
  RedeployDeploymentCase,
  DeleteDeploymentCase,
  GetBuildCase,
  GetDeploymentCase,
  ProcessDeploymentCase,
  StartDeploymentCase,
  StopDeploymentCase,
  TriggerBuildCase,
  UNIT_OF_WORK,
  UpdateDeploymentCase,
  type UnitOfWork,
} from "@kumo/application";
import { createAzureResiliencePolicy, AZURE_CREDENTIAL, AzureProvider, AzureLegacyEnvironmentProvisioner, FeatureFlagsService, AzureContainerLifecycleManager, AzureDeploymentConfigurationReader, DeploymentWorker, InfraDeploymentRepository, StripeProvider, type AzureCredential, type AzureProviderClients } from "@kumo/infrastructure";
import { ConfigService } from "@nestjs/config";
import { AppCacheModule } from "./AppCache.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { DatabaseModule } from "./Database.module.js";
import { BuildModule } from "./Build.module.js";
import { FeatureModule } from "./Feature.module.js";
import { StripeModule } from "./Stripe.module.js";
import { BuildSourceController } from "../controllers/BuildSource.controller.js";
import { DeploymentsController } from "../controllers/Deployments.controller.js";
import { RedeploymentsController } from "../controllers/Redeployments.controller.js";
import { RouteReadCache } from "../common/ReadCache.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, DatabaseModule, BuildModule, StripeModule, FeatureModule, AppCacheModule],
  controllers: [
    BuildSourceController,
    DeploymentsController,
    RedeploymentsController,
  ],
  providers: [
    DeploymentWorker,
    {
      provide: RedeployDeploymentCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider): RedeployDeploymentCase => new RedeployDeploymentCase(uow, subscriptions),
      inject: [UNIT_OF_WORK, StripeProvider],
    },
    {
      provide: ResourceManagementClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): ResourceManagementClient =>
        new ResourceManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: ContainerAppsAPIClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): ContainerAppsAPIClient =>
        new ContainerAppsAPIClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: GetDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, reader: AzureDeploymentConfigurationReader): GetDeploymentCase => new GetDeploymentCase(repository, reader),
      inject: [InfraDeploymentRepository, AzureDeploymentConfigurationReader],
    },
    {
      provide: AzureDeploymentConfigurationReader,
      useFactory: (config: ConfigService, apps: ContainerAppsAPIClient): AzureDeploymentConfigurationReader => new AzureDeploymentConfigurationReader(config, apps.containerApps),
      inject: [ConfigService, ContainerAppsAPIClient],
    },
    {
      provide: AzureContainerLifecycleManager,
      useFactory: (config: ConfigService, apps: ContainerAppsAPIClient): AzureContainerLifecycleManager =>
        new AzureContainerLifecycleManager(config, apps.containerApps),
      inject: [ConfigService, ContainerAppsAPIClient],
    },
    {
      provide: StartDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, lifecycle: AzureContainerLifecycleManager, readCache: RouteReadCache): StartDeploymentCase =>
        new StartDeploymentCase(repository, lifecycle, (userId: string): Promise<void> => readCache.invalidateDeployments(userId)),
      inject: [InfraDeploymentRepository, AzureContainerLifecycleManager, RouteReadCache],
    },
    {
      provide: StopDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, lifecycle: AzureContainerLifecycleManager, readCache: RouteReadCache): StopDeploymentCase =>
        new StopDeploymentCase(repository, lifecycle, (userId: string): Promise<void> => readCache.invalidateDeployments(userId)),
      inject: [InfraDeploymentRepository, AzureContainerLifecycleManager, RouteReadCache],
    },
    {
      provide: ProcessDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider): ProcessDeploymentCase => new ProcessDeploymentCase(repository, provider),
      inject: [InfraDeploymentRepository, AzureProvider],
    },
    {
      provide: StorageManagementClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): StorageManagementClient =>
        new StorageManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), {
          retryOptions: { maxRetries: 0 },
          additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }],
        }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: AzureProvider,
      useFactory: (
        config: ConfigService, triggerBuild: TriggerBuildCase, getBuild: GetBuildCase,
        resources: ResourceManagementClient, apps: ContainerAppsAPIClient, storage: StorageManagementClient, credential: AzureCredential, resilience: ResilienceService, flags: FeatureFlagsService,
      ): AzureProvider => {
        const clients: AzureProviderClients = {
          resources: resources.resources, resourceGroups: resources.resourceGroups,
          managedEnvironments: apps.managedEnvironments, containerApps: apps.containerApps,
          managedEnvironmentsStorages: apps.managedEnvironmentsStorages,
          storageAccounts: storage.storageAccounts, fileShares: storage.fileShares,
        };
        const createLegacy: () => AzureLegacyEnvironmentProvisioner = (): AzureLegacyEnvironmentProvisioner => {
          const network: NetworkManagementClient = new NetworkManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), {
            retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }],
          });
          return new AzureLegacyEnvironmentProvisioner(config, { resourceGroups: resources.resourceGroups,
            managedEnvironments: apps.managedEnvironments, virtualNetworks: network.virtualNetworks }, flags);
        };
        return new AzureProvider(config, triggerBuild, getBuild, clients, createLegacy, flags);
      },
      inject: [ConfigService, TriggerBuildCase, GetBuildCase, ResourceManagementClient, ContainerAppsAPIClient, StorageManagementClient, AZURE_CREDENTIAL, ResilienceService, FeatureFlagsService],
    },
    {
      provide: CreateDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
        subscriptions: StripeProvider,
      ): CreateDeploymentCase => {
        return new CreateDeploymentCase(uow, subscriptions);
      },
      inject: [
        UNIT_OF_WORK,
        StripeProvider,
      ],
    },
    {
      provide: UpdateDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
      ): UpdateDeploymentCase => {
        return new UpdateDeploymentCase(uow);
      },
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: DeleteDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
      ): DeleteDeploymentCase => {
        return new DeleteDeploymentCase(uow);
      },
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: AttachVolumeCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, provider: AzureProvider): AttachVolumeCase =>
        new AttachVolumeCase(uow, subscriptions, provider),
      inject: [UNIT_OF_WORK, StripeProvider, AzureProvider],
    },
    {
      provide: DetachVolumeCase,
      useFactory: (uow: UnitOfWork, provider: AzureProvider): DetachVolumeCase =>
        new DetachVolumeCase(uow, provider),
      inject: [UNIT_OF_WORK, AzureProvider],
    },
    {
      provide: ListVolumesCase,
      useFactory: (uow: UnitOfWork): ListVolumesCase => new ListVolumesCase(uow),
      inject: [UNIT_OF_WORK],
    },
  ],
  exports: [
    RedeployDeploymentCase,
    AzureProvider,
    CreateDeploymentCase,
    GetDeploymentCase,
    UpdateDeploymentCase,
    DeleteDeploymentCase,
    AttachVolumeCase,
    DetachVolumeCase,
    ListVolumesCase,
  ],
})
export class DeploymentModule {}
