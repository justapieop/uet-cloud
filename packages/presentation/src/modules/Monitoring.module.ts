import { GetDeploymentMetricsCase } from "@kumo/application";
import { AzureMonitoringModule, AzureMonitorMetricsReader, InfraDeploymentRepository } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { DeploymentMetricsController } from "../controllers/DeploymentMetrics.controller.js";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [DatabaseModule, AzureMonitoringModule],
  controllers: [DeploymentMetricsController],
  providers: [{
    provide: GetDeploymentMetricsCase,
    useFactory: (repository: InfraDeploymentRepository, reader: AzureMonitorMetricsReader): GetDeploymentMetricsCase =>
      new GetDeploymentMetricsCase(repository, reader),
    inject: [InfraDeploymentRepository, AzureMonitorMetricsReader],
  }],
})
export class MonitoringModule {}
