import { ResilienceService } from "@nestjs/resilience";
import { MonitorClient } from "@azure/arm-monitor";
import { GetDeploymentMetricsCase } from "@kumo/application";
import { createAzureResiliencePolicy, AZURE_CREDENTIAL, AzureMonitorMetricsReader, InfraDeploymentRepository, type AzureCredential } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { DeploymentMetricsController } from "../controllers/DeploymentMetrics.controller.js";
import { DatabaseModule } from "./Database.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { ConfigService } from "@nestjs/config";

@Module({
  imports: [
    DatabaseModule,
    AppConfigModule,
    ExternalClientsModule,
  ],
  controllers: [
    DeploymentMetricsController,
  ],
  providers: [
    {
      provide: MonitorClient,
      useFactory: (config: ConfigService, credential: AzureCredential, resilience: ResilienceService): MonitorClient =>
        new MonitorClient(credential, config.getOrThrow<string>("AZURE_SUBSCRIPTION_ID"), { retryOptions: { maxRetries: 0 }, additionalPolicies: [{ policy: createAzureResiliencePolicy(resilience, "azure-monitor"), position: "perCall" }] }),
      inject: [ConfigService, AZURE_CREDENTIAL, ResilienceService],
    },
    {
      provide: GetDeploymentMetricsCase,
      useFactory: (repository: InfraDeploymentRepository, reader: AzureMonitorMetricsReader): GetDeploymentMetricsCase =>
        new GetDeploymentMetricsCase(repository, reader),
      inject: [InfraDeploymentRepository, AzureMonitorMetricsReader],
    },
    {
      provide: AzureMonitorMetricsReader,
      useFactory: (config: ConfigService, client: MonitorClient): AzureMonitorMetricsReader => new AzureMonitorMetricsReader(config, client.metrics),
      inject: [ConfigService, MonitorClient],
    },
  ],
})
export class MonitoringModule {}
