import { DefaultAzureCredential } from "@azure/identity";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { AZURE_CREDENTIAL, HTTP_TRANSPORT, createAzureResiliencePolicy, createResilientHttpTransport, type AzureCredential, type HttpTransport } from "@kumo/infrastructure";
import { ResilienceService } from "@nestjs/resilience";
import { ConfigService } from "@nestjs/config";
import { AppResilienceModule } from "./AppResilience.module.js";
import { Module } from "@nestjs/common";

@Module({
  imports: [AppResilienceModule],
  providers: [
    { provide: AZURE_CREDENTIAL, useFactory: (): DefaultAzureCredential => new DefaultAzureCredential() },
    { provide: HTTP_TRANSPORT, useFactory: (resilience: ResilienceService): HttpTransport => createResilientHttpTransport(globalThis.fetch.bind(globalThis), resilience), inject: [ResilienceService] },
    {
      provide: ContainerAppsAPIClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): ContainerAppsAPIClient =>
        new ContainerAppsAPIClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-arm"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
  ],
  exports: [AZURE_CREDENTIAL, HTTP_TRANSPORT, ContainerAppsAPIClient],
})
export class ExternalClientsModule {}
