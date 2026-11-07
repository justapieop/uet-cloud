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
  CreateVolumeCase,
  ListUserVolumesCase,
  DeleteVolumeCase,
  CreateDeploymentCase,
  RedeployDeploymentCase,
  UpdateDeploymentResourcesCase,
  GetDeploymentResourceUpdateCase,
  ProcessDeploymentResourceUpdateCase,
  DEPLOYMENT_CONFIGURATION_UPDATER,
  DeleteDeploymentCase,
  DEPLOYMENT_OPERATION_LOCK,
  GetBuildCase,
  GetDeploymentCase,
  ProcessDeploymentCase,
  ProcessDeploymentDeletionCase,
  StartDeploymentCase,
  StopDeploymentCase,
  TriggerBuildCase,
  UNIT_OF_WORK,
  UpdateDeploymentCase,
  type UnitOfWork,
  type DeploymentOperationLock,
} from "@kumo/application";
import { createAzureResiliencePolicy, AZURE_CREDENTIAL, AzureProvider, AzureDeploymentDeleter, AzureLegacyEnvironmentProvisioner, FeatureFlagsService, AzureContainerLifecycleManager, AzureDeploymentConfigurationReader, AzureDeploymentConfigurationUpdater, DeploymentResourceUpdateWorker, InfraDeploymentResourceUpdateRepository, DeploymentWorker, InfraDeploymentRepository, StripeProvider, type AzureCredential, type AzureProviderClients } from "@kumo/infrastructure";
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
import { VolumesController } from "../controllers/Volumes.controller.js";
import { RouteReadCache } from "../common/ReadCache.js";
import { DeploymentResourcesController } from "../controllers/DeploymentResources.controller.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, DatabaseModule, BuildModule, StripeModule, FeatureModule, AppCacheModule],
  controllers: [
    BuildSourceController,
    DeploymentsController,
    RedeploymentsController,
    DeploymentResourcesController,
    VolumesController,
  ],
  providers: [
    DeploymentWorker,
    {
      provide: UpdateDeploymentResourcesCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, updater: AzureDeploymentConfigurationUpdater, lock: DeploymentOperationLock, readCache: RouteReadCache): UpdateDeploymentResourcesCase =>
        new UpdateDeploymentResourcesCase(uow, subscriptions, updater, lock, undefined,
          (userId: string): Promise<void> => readCache.invalidateDeployments(userId)),
      inject: [UNIT_OF_WORK, StripeProvider, AzureDeploymentConfigurationUpdater, DEPLOYMENT_OPERATION_LOCK, RouteReadCache],
    },
    {
      provide: GetDeploymentResourceUpdateCase,
      useFactory: (uow: UnitOfWork): GetDeploymentResourceUpdateCase => new GetDeploymentResourceUpdateCase(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: ProcessDeploymentResourceUpdateCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, updater: AzureDeploymentConfigurationUpdater, lock: DeploymentOperationLock, queue: InfraDeploymentResourceUpdateRepository, readCache: RouteReadCache): ProcessDeploymentResourceUpdateCase =>
        new ProcessDeploymentResourceUpdateCase(uow, subscriptions, updater, lock, queue,
          (userId: string): Promise<void> => readCache.invalidateDeployments(userId)),
      inject: [UNIT_OF_WORK, StripeProvider, AzureDeploymentConfigurationUpdater, DEPLOYMENT_OPERATION_LOCK, InfraDeploymentResourceUpdateRepository, RouteReadCache],
    },
    {
      provide: DeploymentResourceUpdateWorker,
      useFactory: (repository: InfraDeploymentResourceUpdateRepository, processUpdate: ProcessDeploymentResourceUpdateCase, config: ConfigService, readCache: RouteReadCache): DeploymentResourceUpdateWorker =>
        new DeploymentResourceUpdateWorker(repository, processUpdate, config, (userId: string): Promise<void> => readCache.invalidateDeployments(userId)),
      inject: [InfraDeploymentResourceUpdateRepository, ProcessDeploymentResourceUpdateCase, ConfigService, RouteReadCache],
    },
    {
      provide: RedeployDeploymentCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, reader: AzureDeploymentConfigurationReader, lock: DeploymentOperationLock): RedeployDeploymentCase => new RedeployDeploymentCase(uow, subscriptions, reader, lock),
      inject: [UNIT_OF_WORK, StripeProvider, AzureDeploymentConfigurationReader, DEPLOYMENT_OPERATION_LOCK],
    },
    {
      provide: ResourceManagementClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): ResourceManagementClient =>
        new ResourceManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: GetDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, reader: AzureDeploymentConfigurationReader, updates: InfraDeploymentResourceUpdateRepository): GetDeploymentCase => new GetDeploymentCase(repository, reader, updates),
      inject: [InfraDeploymentRepository, AzureDeploymentConfigurationReader, InfraDeploymentResourceUpdateRepository],
    },
    {
      provide: AzureDeploymentConfigurationReader,
      useFactory: (config: ConfigService, apps: ContainerAppsAPIClient): AzureDeploymentConfigurationReader => new AzureDeploymentConfigurationReader(config, apps.containerApps, apps.containerAppsRevisions),
      inject: [ConfigService, ContainerAppsAPIClient],
    },
    {
      provide: AzureDeploymentConfigurationUpdater,
      useFactory: (config: ConfigService, apps: ContainerAppsAPIClient, reader: AzureDeploymentConfigurationReader): AzureDeploymentConfigurationUpdater =>
        new AzureDeploymentConfigurationUpdater(config, apps.containerApps, apps.containerAppsRevisions, reader),
      inject: [ConfigService, ContainerAppsAPIClient, AzureDeploymentConfigurationReader],
    },
    { provide: DEPLOYMENT_CONFIGURATION_UPDATER, useExisting: AzureDeploymentConfigurationUpdater },
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
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider, uow: UnitOfWork, subscriptions: StripeProvider): ProcessDeploymentCase => new ProcessDeploymentCase(repository, provider, uow, subscriptions),
      inject: [InfraDeploymentRepository, AzureProvider, UNIT_OF_WORK, StripeProvider],
    },
    {
      provide: AzureDeploymentDeleter,
      useFactory: (config: ConfigService, resources: ResourceManagementClient, apps: ContainerAppsAPIClient): AzureDeploymentDeleter =>
        new AzureDeploymentDeleter(config, {
          containerApps: apps.containerApps,
          managedEnvironmentsStorages: apps.managedEnvironmentsStorages,
          resources: resources.resources,
        }),
      inject: [ConfigService, ResourceManagementClient, ContainerAppsAPIClient],
    },
    {
      provide: ProcessDeploymentDeletionCase,
      useFactory: (repository: InfraDeploymentRepository, deleter: AzureDeploymentDeleter): ProcessDeploymentDeletionCase =>
        new ProcessDeploymentDeletionCase(repository, deleter),
      inject: [InfraDeploymentRepository, AzureDeploymentDeleter],
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
        resources: ResourceManagementClient, apps: ContainerAppsAPIClient, storage: StorageManagementClient, credential: AzureCredential, resilience: ResilienceService, flags: FeatureFlagsService, reader: AzureDeploymentConfigurationReader,
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
        return new AzureProvider(config, triggerBuild, getBuild, clients, createLegacy, flags, reader);
      },
      inject: [ConfigService, TriggerBuildCase, GetBuildCase, ResourceManagementClient, ContainerAppsAPIClient, StorageManagementClient, AZURE_CREDENTIAL, ResilienceService, FeatureFlagsService, AzureDeploymentConfigurationReader],
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
        operationLock: DeploymentOperationLock,
      ): DeleteDeploymentCase => {
        return new DeleteDeploymentCase(uow, operationLock);
      },
      inject: [
        UNIT_OF_WORK,
        DEPLOYMENT_OPERATION_LOCK,
      ],
    },
    {
      provide: AttachVolumeCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, provider: AzureProvider, operationLock: DeploymentOperationLock): AttachVolumeCase =>
        new AttachVolumeCase(uow, subscriptions, provider, operationLock),
      inject: [UNIT_OF_WORK, StripeProvider, AzureProvider, DEPLOYMENT_OPERATION_LOCK],
    },
    {
      provide: DetachVolumeCase,
      useFactory: (uow: UnitOfWork, provider: AzureProvider, operationLock: DeploymentOperationLock): DetachVolumeCase =>
        new DetachVolumeCase(uow, provider, operationLock),
      inject: [UNIT_OF_WORK, AzureProvider, DEPLOYMENT_OPERATION_LOCK],
    },
    {
      provide: ListVolumesCase,
      useFactory: (uow: UnitOfWork): ListVolumesCase => new ListVolumesCase(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: CreateVolumeCase,
      useFactory: (uow: UnitOfWork, subscriptions: StripeProvider, provider: AzureProvider): CreateVolumeCase =>
        new CreateVolumeCase(uow, subscriptions, provider),
      inject: [UNIT_OF_WORK, StripeProvider, AzureProvider],
    },
    {
      provide: ListUserVolumesCase,
      useFactory: (uow: UnitOfWork): ListUserVolumesCase => new ListUserVolumesCase(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: DeleteVolumeCase,
      useFactory: (uow: UnitOfWork, provider: AzureProvider): DeleteVolumeCase =>
        new DeleteVolumeCase(uow, provider),
      inject: [UNIT_OF_WORK, AzureProvider],
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
    CreateVolumeCase,
    ListUserVolumesCase,
    DeleteVolumeCase,
  ],
})
export class DeploymentModule {}
