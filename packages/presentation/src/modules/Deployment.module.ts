import { Module } from "@nestjs/common";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
<<<<<<< Updated upstream
  DeleteUserResourceGroupCase,
  DEPLOYMENT_REPOSITORY,
=======
  GetBuildCase,
  GetDeploymentCase,
  GetDeploymentMetricsCase,
  ProcessDeploymentCase,
  TriggerBuildCase,
  UNIT_OF_WORK,
>>>>>>> Stashed changes
  UpdateDeploymentCase,
  type DeploymentRepository,
} from "@kumo/application";
<<<<<<< Updated upstream
import { AzureDeployService } from "@kumo/infrastructure";
import { DeploymentMutationController } from "../controllers/DeploymentMutation.controller.js";
=======
import { AzureMonitorMetricsReader, AzureMonitorModule, AzureProvider, DeploymentWorker, InfraDeploymentRepository } from "@kumo/infrastructure";
import { ConfigService } from "@nestjs/config";
>>>>>>> Stashed changes
import { DatabaseModule } from "./Database.module.js";

@Module({
<<<<<<< Updated upstream
  imports: [DatabaseModule],
  controllers: [DeploymentMutationController],
  providers: [
    AzureDeployService,
=======
  imports: [DatabaseModule, BuildModule, AzureMonitorModule],
  controllers: [
    DeploymentController,
    BuildSourceController,
    DeploymentsController,
  ],
  providers: [
    DeploymentWorker,
    {
      provide: GetDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository): GetDeploymentCase => new GetDeploymentCase(repository),
      inject: [InfraDeploymentRepository],
    },
    {
      provide: GetDeploymentMetricsCase,
      useFactory: (deployment: GetDeploymentCase, reader: AzureMonitorMetricsReader): GetDeploymentMetricsCase =>
        new GetDeploymentMetricsCase(deployment, reader),
      inject: [GetDeploymentCase, AzureMonitorMetricsReader],
    },
    {
      provide: ProcessDeploymentCase,
      useFactory: (repository: InfraDeploymentRepository, provider: AzureProvider): ProcessDeploymentCase => new ProcessDeploymentCase(repository, provider),
      inject: [InfraDeploymentRepository, AzureProvider],
    },
    {
      provide: AzureProvider,
      useFactory: (config: ConfigService, triggerBuild: TriggerBuildCase, getBuild: GetBuildCase): AzureProvider =>
        new AzureProvider(config, triggerBuild, getBuild),
      inject: [ConfigService, TriggerBuildCase, GetBuildCase],
    },
>>>>>>> Stashed changes
    {
      provide: CreateDeploymentCase,
      useFactory: (
        deployService: AzureDeployService,
        deploymentRepository: DeploymentRepository,
      ): CreateDeploymentCase => {
        return new CreateDeploymentCase(deployService, deploymentRepository);
      },
      inject: [AzureDeployService, DEPLOYMENT_REPOSITORY],
    },
    {
      provide: UpdateDeploymentCase,
      useFactory: (
        deployService: AzureDeployService,
        deploymentRepository: DeploymentRepository,
      ): UpdateDeploymentCase => {
        return new UpdateDeploymentCase(deployService, deploymentRepository);
      },
      inject: [AzureDeployService, DEPLOYMENT_REPOSITORY],
    },
    {
      provide: DeleteDeploymentCase,
      useFactory: (
        deployService: AzureDeployService,
        deploymentRepository: DeploymentRepository,
      ): DeleteDeploymentCase => {
        return new DeleteDeploymentCase(deployService, deploymentRepository);
      },
      inject: [AzureDeployService, DEPLOYMENT_REPOSITORY],
    },
    {
      provide: DeleteUserResourceGroupCase,
      useFactory: (
        deployService: AzureDeployService,
        deploymentRepository: DeploymentRepository,
      ): DeleteUserResourceGroupCase => {
        return new DeleteUserResourceGroupCase(
          deployService,
          deploymentRepository,
        );
      },
      inject: [AzureDeployService, DEPLOYMENT_REPOSITORY],
    },
  ],
  exports: [
    AzureDeployService,
    CreateDeploymentCase,
<<<<<<< Updated upstream
=======
    GetDeploymentCase,
    GetDeploymentMetricsCase,
>>>>>>> Stashed changes
    UpdateDeploymentCase,
    DeleteDeploymentCase,
    DeleteUserResourceGroupCase,
  ],
})
export class DeploymentModule {}
