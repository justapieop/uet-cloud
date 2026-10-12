import { Module } from "@nestjs/common";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
  DeleteUserResourceGroupCase,
  DEPLOYMENT_REPOSITORY,
  UpdateDeploymentCase,
  type DeploymentRepository,
} from "@kumo/application";
import { AzureDeployService } from "@kumo/infrastructure";
import { DeploymentMutationController } from "../controllers/DeploymentMutation.controller.js";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [DatabaseModule],
  controllers: [DeploymentMutationController],
  providers: [
    AzureDeployService,
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
    UpdateDeploymentCase,
    DeleteDeploymentCase,
    DeleteUserResourceGroupCase,
  ],
})
export class DeploymentModule {}
