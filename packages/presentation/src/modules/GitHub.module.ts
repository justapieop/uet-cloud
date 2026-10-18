import { ResilienceService } from "@nestjs/resilience";
import { KeyClient } from "@azure/keyvault-keys";
import {
  createAzureResiliencePolicy, AZURE_CREDENTIAL, HTTP_TRANSPORT, KmsProvider, GitHubProvider,
  type AzureCredential, type HttpTransport,
} from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule],
  providers: [
    {
      provide: KeyClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): KeyClient => {
        const vault: string = config.getOrThrow<string>("AZURE_VAULT_NAME");
        const vaultUrl: string = vault.startsWith("https://") ? vault : `https://${vault}.vault.azure.net`;
        return new KeyClient(vaultUrl, credential, { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "key-vault"), position: "perCall" }] });
      },
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: KmsProvider,
      useFactory: (client: KeyClient): KmsProvider => new KmsProvider(client),
      inject: [KeyClient],
    },
    {
      provide: GitHubProvider,
      useFactory: (kms: KmsProvider, config: ConfigService, http: HttpTransport): GitHubProvider => new GitHubProvider(kms, config, http),
      inject: [KmsProvider, ConfigService, HTTP_TRANSPORT],
    },
  ],
  exports: [GitHubProvider],
})
export class GitHubModule {}
