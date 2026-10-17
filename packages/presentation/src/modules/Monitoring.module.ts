import { GetDeploymentMetricsCase } from "@kumo/application";
import { AzureMonitorMetricsReader, InfraDeploymentRepository } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { DeploymentMetricsController } from "../controllers/DeploymentMetrics.controller.js";
import { DatabaseModule } from "./Database.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { ConfigService } from "@nestjs/config";

@Module({
  imports: [
    DatabaseModule,
    AppConfigModule,
  ],
  controllers: [
    DeploymentMetricsController,
  ],
  providers: [
    {
      provide: GetDeploymentMetricsCase,
      useFactory: (repository: InfraDeploymentRepository, reader: AzureMonitorMetricsReader): GetDeploymentMetricsCase =>
        new GetDeploymentMetricsCase(repository, reader),
      inject: [InfraDeploymentRepository, AzureMonitorMetricsReader],
    },
    {
      provide: AzureMonitorMetricsReader,
      useFactory: (config: ConfigService): AzureMonitorMetricsReader => new AzureMonitorMetricsReader(config),
      inject: [ConfigService],
    },
  ],
})
export class MonitoringModule {}
