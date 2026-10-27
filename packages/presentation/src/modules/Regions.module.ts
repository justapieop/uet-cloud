import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetDeploymentRegionsCase, type DeploymentRegionsReader } from "@kumo/application";
import { AZURE_CREDENTIAL, HTTP_TRANSPORT, AzureDeploymentRegionsReader, AzureLegacyDeploymentRegionsReader, FeatureFlagsService, type AzureCredential, type HttpTransport } from "@kumo/infrastructure";
import { FeatureModule } from "./Feature.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { RegionsController } from "../controllers/Regions.controller.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, FeatureModule],
  controllers: [RegionsController],
  providers: [
    { provide: AzureDeploymentRegionsReader,
      useFactory: (config: ConfigService, credential: AzureCredential, http: HttpTransport, flags: FeatureFlagsService): DeploymentRegionsReader =>
        new AzureDeploymentRegionsReader(config, credential, http, flags, new AzureLegacyDeploymentRegionsReader(config, credential, http, flags)),
      inject: [ConfigService, AZURE_CREDENTIAL, HTTP_TRANSPORT, FeatureFlagsService] },
    { provide: GetDeploymentRegionsCase,
      useFactory: (reader: DeploymentRegionsReader): GetDeploymentRegionsCase => new GetDeploymentRegionsCase(reader),
      inject: [AzureDeploymentRegionsReader] },
  ],
})
export class RegionsModule {}
