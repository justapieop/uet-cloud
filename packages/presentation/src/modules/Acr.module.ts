import { ContainerRegistryTasksManagementClient } from "@azure/arm-containerregistrytasks";
import { AcrProvider, AZURE_CREDENTIAL, HTTP_TRANSPORT, type AzureCredential, type HttpTransport } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule],
  providers: [
    {
      provide: ContainerRegistryTasksManagementClient,
      useFactory: (config: ConfigService, credential: AzureCredential): ContainerRegistryTasksManagementClient =>
        new ContainerRegistryTasksManagementClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID")),
      inject: [ConfigService, AZURE_CREDENTIAL],
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
