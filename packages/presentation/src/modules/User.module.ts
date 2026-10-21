import { Module } from "@nestjs/common";
import { DatabaseModule } from "./Database.module.js";
import { CreateUserCase, FindUserByIdCase, UNIT_OF_WORK, type UnitOfWork } from "@kumo/application";
import { UserController } from "../controllers/User.controller.js";

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    {
      provide: CreateUserCase,
      useFactory: (uow: UnitOfWork): CreateUserCase => new CreateUserCase(uow),
      inject: [
        UNIT_OF_WORK,
      ],
    },
    {
      provide: FindUserByIdCase,
      useFactory: (uow: UnitOfWork) => new FindUserByIdCase(uow),
      inject: [
        UNIT_OF_WORK,
      ],
    }
  ],
  exports: [
    CreateUserCase,
    FindUserByIdCase,
  ],
  controllers: [
    UserController,
  ],
})
export class UserModule { }