import { ResilienceService } from "@nestjs/resilience";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { ResourceManagementClient } from "@azure/arm-resources";
import { Module } from "@nestjs/common";
import {
  CreateDeploymentCase,
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
import { createAzureResiliencePolicy, AZURE_CREDENTIAL, AzureProvider, DeploymentWorker, InfraDeploymentRepository, StripeProvider, type AzureCredential, type AzureProviderClients } from "@kumo/infrastructure";
import { ConfigService } from "@nestjs/config";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { DatabaseModule } from "./Database.module.js";
import { BuildModule } from "./Build.module.js";
import { StripeModule } from "./Stripe.module.js";
import { DeploymentController } from "../controllers/Deployment.controller.js";
import { BuildSourceController } from "../controllers/BuildSource.controller.js";
import { DeploymentsController } from "../controllers/Deployments.controller.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, DatabaseModule, BuildModule, StripeModule],
  controllers: [
    DeploymentController,
    BuildSourceController,
    DeploymentsController,
  ],
  providers: [
    DeploymentWorker,
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
      useFactory: (repository: InfraDeploymentRepository): GetDeploymentCase => new GetDeploymentCase(repository),
      inject: [InfraDeploymentRepository],
    },
    {
      provide: StartDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider): StartDeploymentCase => new StartDeploymentCase(repository, provider),
      inject: [InfraDeploymentRepository, AzureProvider],
    },
    {
      provide: StopDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider): StopDeploymentCase => new StopDeploymentCase(repository, provider),
      inject: [InfraDeploymentRepository, AzureProvider],
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
        resources: ResourceManagementClient, apps: ContainerAppsAPIClient,
      ): AzureProvider => {
        const clients: AzureProviderClients = {
          resources: resources.resources, resourceGroups: resources.resourceGroups,
          managedEnvironments: apps.managedEnvironments, containerApps: apps.containerApps,
        };
        return new AzureProvider(config, triggerBuild, getBuild, clients);
      },
      inject: [ConfigService, TriggerBuildCase, GetBuildCase, ResourceManagementClient, ContainerAppsAPIClient],
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
    AzureProvider,
    CreateDeploymentCase,
    GetDeploymentCase,
    UpdateDeploymentCase,
    DeleteDeploymentCase,
  ],
})
export class DeploymentModule {}
