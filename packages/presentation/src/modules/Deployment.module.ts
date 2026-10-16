import { Module } from "@nestjs/common";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
  GetBuildCase,
  TriggerBuildCase,
  UNIT_OF_WORK,
  UpdateDeploymentCase,
  type UnitOfWork,
} from "@kumo/application";
import { AzureProvider } from "@kumo/infrastructure";
import { ConfigService } from "@nestjs/config";
import { DatabaseModule } from "./Database.module.js";
import { BuildModule } from "./Build.module.js";
import { DeploymentController } from "../controllers/Deployment.controller.js";
import { BuildSourceController } from "../controllers/BuildSource.controller.js";

@Module({
  imports: [DatabaseModule, BuildModule],
  controllers: [
    DeploymentController,
    BuildSourceController,
  ],
  providers: [
    {
      provide: AzureProvider,
      useFactory: (config: ConfigService, triggerBuild: TriggerBuildCase, getBuild: GetBuildCase): AzureProvider =>
        new AzureProvider(config, triggerBuild, getBuild),
      inject: [ConfigService, TriggerBuildCase, GetBuildCase],
    },
    {
      provide: CreateDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
      ): CreateDeploymentCase => {
        return new CreateDeploymentCase(uow);
      },
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: UpdateDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
      ): UpdateDeploymentCase => {
        return new UpdateDeploymentCase(uow);
      },
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: DeleteDeploymentCase,
      useFactory: (
        uow: UnitOfWork,
      ): DeleteDeploymentCase => {
        return new DeleteDeploymentCase(uow);
      },
      inject: [
        UNIT_OF_WORK,
      ],
    },
  ],
  exports: [
    AzureProvider,
    CreateDeploymentCase,
    UpdateDeploymentCase,
    DeleteDeploymentCase,
  ],
})
export class DeploymentModule {}
