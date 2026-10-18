import {
  ActivateSubscriptionCase, ChangeSubscriptionPlanCase, CreateSubscriptionCase,
  DeactivateSubscriptionCase, EnsureActiveSubscriptionCase, GetSubscriptionCase,
  SUBSCRIPTION_REPOSITORY, SUBSCRIPTION_UNIT_OF_WORK,
  type SubscriptionRepository, type SubscriptionUnitOfWork,
} from "@kumo/application";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: CreateSubscriptionCase,
      useFactory: (unitOfWork: SubscriptionUnitOfWork): CreateSubscriptionCase => new CreateSubscriptionCase(unitOfWork),
      inject: [SUBSCRIPTION_UNIT_OF_WORK],
    },
    {
      provide: GetSubscriptionCase,
      useFactory: (repository: SubscriptionRepository): GetSubscriptionCase => new GetSubscriptionCase(repository),
      inject: [SUBSCRIPTION_REPOSITORY],
    },
    {
      provide: ChangeSubscriptionPlanCase,
      useFactory: (unitOfWork: SubscriptionUnitOfWork): ChangeSubscriptionPlanCase => new ChangeSubscriptionPlanCase(unitOfWork),
      inject: [SUBSCRIPTION_UNIT_OF_WORK],
    },
    {
      provide: ActivateSubscriptionCase,
      useFactory: (unitOfWork: SubscriptionUnitOfWork): ActivateSubscriptionCase => new ActivateSubscriptionCase(unitOfWork),
      inject: [SUBSCRIPTION_UNIT_OF_WORK],
    },
    {
      provide: DeactivateSubscriptionCase,
      useFactory: (unitOfWork: SubscriptionUnitOfWork): DeactivateSubscriptionCase => new DeactivateSubscriptionCase(unitOfWork),
      inject: [SUBSCRIPTION_UNIT_OF_WORK],
    },
    {
      provide: EnsureActiveSubscriptionCase,
      useFactory: (repository: SubscriptionRepository): EnsureActiveSubscriptionCase => new EnsureActiveSubscriptionCase(repository),
      inject: [SUBSCRIPTION_REPOSITORY],
    },
  ],
  exports: [
    CreateSubscriptionCase, GetSubscriptionCase, ChangeSubscriptionPlanCase,
    ActivateSubscriptionCase, DeactivateSubscriptionCase, EnsureActiveSubscriptionCase,
  ],
})
export class SubscriptionModule {}
