import { DefaultAzureCredential } from "@azure/identity";
import { AZURE_CREDENTIAL, HTTP_TRANSPORT, createResilientHttpTransport, type HttpTransport } from "@kumo/infrastructure";
import { ResilienceService } from "@nestjs/resilience";
import { AppResilienceModule } from "./AppResilience.module.js";
import { Module } from "@nestjs/common";

@Module({
  imports: [AppResilienceModule],
  providers: [
    { provide: AZURE_CREDENTIAL, useFactory: (): DefaultAzureCredential => new DefaultAzureCredential() },
    { provide: HTTP_TRANSPORT, useFactory: (resilience: ResilienceService): HttpTransport => createResilientHttpTransport(globalThis.fetch.bind(globalThis), resilience), inject: [ResilienceService] },
  ],
  exports: [AZURE_CREDENTIAL, HTTP_TRANSPORT],
})
export class ExternalClientsModule {}
