import { DefaultAzureCredential } from "@azure/identity";
import { AZURE_CREDENTIAL, HTTP_TRANSPORT, type HttpTransport } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";

@Module({
  providers: [
    { provide: AZURE_CREDENTIAL, useFactory: (): DefaultAzureCredential => new DefaultAzureCredential() },
    { provide: HTTP_TRANSPORT, useFactory: (): HttpTransport => globalThis.fetch.bind(globalThis) },
  ],
  exports: [AZURE_CREDENTIAL, HTTP_TRANSPORT],
})
export class ExternalClientsModule {}
