import { Module } from "@nestjs/common";
import { FindRoleByIdCase, UNIT_OF_WORK, type UnitOfWork } from "@kumo/application";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    {
      provide: FindRoleByIdCase,
      useFactory: (uow: UnitOfWork) => new FindRoleByIdCase(uow),
      inject: [
        UNIT_OF_WORK,
      ],
    },
  ],
  exports: [
    FindRoleByIdCase,
  ],
})
export class RoleModule {

}