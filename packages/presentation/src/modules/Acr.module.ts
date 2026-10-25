import { ResilienceService } from "@nestjs/resilience";
import { ContainerRegistryTasksManagementClient } from "@azure/arm-containerregistrytasks";
import { AcrProvider, createAzureResiliencePolicy, AZURE_CREDENTIAL, HTTP_TRANSPORT, type AzureCredential, type HttpTransport } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule],
  providers: [
    {
      provide: ContainerRegistryTasksManagementClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): ContainerRegistryTasksManagementClient =>
        new ContainerRegistryTasksManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "acr"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: AcrProvider,
      useFactory: (config: ConfigService, client: ContainerRegistryTasksManagementClient, http: HttpTransport): AcrProvider =>
        new AcrProvider(config, client, http),
      inject: [ConfigService, ContainerRegistryTasksManagementClient, HTTP_TRANSPORT],
    },
  ],
  exports: [AcrProvider],
})
export class AcrModule {}
