import { Module } from "@nestjs/common";
import {
  CreateDeploymentCase,
  DeleteDeploymentCase,
  UNIT_OF_WORK,
  UpdateDeploymentCase,
  type UnitOfWork,
} from "@kumo/application";
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
    CreateDeploymentCase,
    UpdateDeploymentCase,
    DeleteDeploymentCase,
  ],
})
export class DeploymentModule {}
