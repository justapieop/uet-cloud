import { InfraStripeCustomerLinkRepository, StripeProvider } from "@kumo/infrastructure";
import { StripeModule } from "./Stripe.module.js";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "./Database.module.js";
import { CreateUserCase, FindUserByIdCase, LinkStripeCustomerCase, UNIT_OF_WORK, type UnitOfWork } from "@kumo/application";
import { UserController } from "../controllers/User.controller.js";

@Module({
  imports: [
    DatabaseModule,
    StripeModule,
  ],
  providers: [
    {
      provide: LinkStripeCustomerCase,
      useFactory: (repository: InfraStripeCustomerLinkRepository, stripe: StripeProvider): LinkStripeCustomerCase =>
        new LinkStripeCustomerCase(repository, stripe),
      inject: [InfraStripeCustomerLinkRepository, StripeProvider],
    },
    {
      provide: CreateUserCase,
      useFactory: (uow: UnitOfWork, link: LinkStripeCustomerCase): CreateUserCase => new CreateUserCase(uow, link),
      inject: [
        UNIT_OF_WORK,
        LinkStripeCustomerCase,
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