import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetDeploymentRegionsCase } from "@kumo/application";
import { AZURE_CREDENTIAL, HTTP_TRANSPORT, AzureDeploymentRegionsReader, type AzureCredential, type HttpTransport } from "@kumo/infrastructure";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { RegionsController } from "../controllers/Regions.controller.js";

@Module({
  imports: [AppConfigModule, ExternalClientsModule],
  controllers: [RegionsController],
  providers: [
    { provide: AzureDeploymentRegionsReader,
      useFactory: (config: ConfigService, credential: AzureCredential, http: HttpTransport): AzureDeploymentRegionsReader => new AzureDeploymentRegionsReader(config, credential, http),
      inject: [ConfigService, AZURE_CREDENTIAL, HTTP_TRANSPORT] },
    { provide: GetDeploymentRegionsCase,
      useFactory: (reader: AzureDeploymentRegionsReader): GetDeploymentRegionsCase => new GetDeploymentRegionsCase(reader),
      inject: [AzureDeploymentRegionsReader] },
  ],
})
export class RegionsModule {}
