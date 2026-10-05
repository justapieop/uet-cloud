import { Module } from "@nestjs/common";
import { CreateDeploymentCase, UpdateDeploymentCase } from "@kumo/application";
import { AzureDeployService } from "@kumo/infrastructure";
import { DeploymentMutationController } from "../controllers/DeploymentMutation.controller.js";

@Module({
  controllers: [DeploymentMutationController],
  providers: [
    AzureDeployService,
    {
      provide: CreateDeploymentCase,
      useFactory: (deployService: AzureDeployService): CreateDeploymentCase => {
        return new CreateDeploymentCase(deployService);
      },
      inject: [AzureDeployService],
    },
    {
      provide: UpdateDeploymentCase,
      useFactory: (deployService: AzureDeployService): UpdateDeploymentCase => {
        return new UpdateDeploymentCase(deployService);
      },
      inject: [AzureDeployService],
    },
  ],
  exports: [
    AzureDeployService,
    CreateDeploymentCase,
    UpdateDeploymentCase,
  ],
})
export class DeploymentModule {}
