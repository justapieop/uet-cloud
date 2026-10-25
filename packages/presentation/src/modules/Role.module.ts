import { Module } from "@nestjs/common";
import {
  FindRoleByIdCase,
  GetRoleCatalogCase,
  GetUserRoleAssignmentsCase,
  ManageRolesCase,
  ReplaceUserRolesCase,
  UNIT_OF_WORK,
  type UnitOfWork,
} from "@kumo/application";
import { InfraRoleRepository } from "@kumo/infrastructure";
import { DatabaseModule } from "./Database.module.js";
import { RolesController } from "../controllers/Roles.controller.js";
import { UserRolesController } from "../controllers/UserRoles.controller.js";

@Module({
  imports: [
    DatabaseModule,
  ],
  controllers: [
    RolesController,
    UserRolesController,
  ],
  providers: [
    {
      provide: FindRoleByIdCase,
      useFactory: (uow: UnitOfWork) => new FindRoleByIdCase(uow),
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: GetRoleCatalogCase,
      useFactory: (roles: InfraRoleRepository): GetRoleCatalogCase => new GetRoleCatalogCase(roles),
      inject: [
        InfraRoleRepository,
      ],
    },
    {
      provide: ManageRolesCase,
      useFactory: (uow: UnitOfWork): ManageRolesCase => new ManageRolesCase(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: GetUserRoleAssignmentsCase,
      useFactory: (uow: UnitOfWork): GetUserRoleAssignmentsCase => new GetUserRoleAssignmentsCase(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: ReplaceUserRolesCase,
      useFactory: (uow: UnitOfWork): ReplaceUserRolesCase => new ReplaceUserRolesCase(uow),
      inject: [UNIT_OF_WORK],
    },
  ],
  exports: [
    FindRoleByIdCase,
    GetRoleCatalogCase,
    ManageRolesCase,
    GetUserRoleAssignmentsCase,
    ReplaceUserRolesCase,
  ],
})
export class RoleModule {

}
