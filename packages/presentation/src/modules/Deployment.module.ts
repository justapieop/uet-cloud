import { ResilienceService } from "@nestjs/resilience";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { NetworkManagementClient } from "@azure/arm-network";
import { ResourceManagementClient } from "@azure/arm-resources";
import { Module } from "@nestjs/common";
import {
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
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { DatabaseModule } from "./Database.module.js";
import { BuildModule } from "./Build.module.js";
import { FeatureModule } from "./Feature.module.js";
import { StripeModule } from "./Stripe.module.js";
import { BuildSourceController } from "../controllers/BuildSource.controller.js";
import { DeploymentsController } from "../controllers/Deployments.controller.js";
import { RedeploymentsController } from "../controllers/Redeployments.controller.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, DatabaseModule, BuildModule, StripeModule, FeatureModule],
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
      useFactory: (repository: InfraDeploymentRepository, lifecycle: AzureContainerLifecycleManager): StartDeploymentCase => new StartDeploymentCase(repository, lifecycle),
      inject: [InfraDeploymentRepository, AzureContainerLifecycleManager],
    },
    {
      provide: StopDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, lifecycle: AzureContainerLifecycleManager): StopDeploymentCase => new StopDeploymentCase(repository, lifecycle),
      inject: [InfraDeploymentRepository, AzureContainerLifecycleManager],
    },
    {
      provide: ProcessDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider): ProcessDeploymentCase => new ProcessDeploymentCase(repository, provider),
      inject: [InfraDeploymentRepository, AzureProvider],
    },
    {
      provide: AzureProvider,
      useFactory: (
        config: ConfigService, triggerBuild: TriggerBuildCase, getBuild: GetBuildCase,
        resources: ResourceManagementClient, apps: ContainerAppsAPIClient, credential: AzureCredential, resilience: ResilienceService, flags: FeatureFlagsService,
      ): AzureProvider => {
        const clients: AzureProviderClients = {
          resources: resources.resources, resourceGroups: resources.resourceGroups,
          managedEnvironments: apps.managedEnvironments, containerApps: apps.containerApps,
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
      inject: [ConfigService, TriggerBuildCase, GetBuildCase, ResourceManagementClient, ContainerAppsAPIClient, AZURE_CREDENTIAL, ResilienceService, FeatureFlagsService],
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
  ],
  exports: [
    RedeployDeploymentCase,
    AzureProvider,
    CreateDeploymentCase,
    GetDeploymentCase,
    UpdateDeploymentCase,
    DeleteDeploymentCase,
  ],
})
export class DeploymentModule {}
