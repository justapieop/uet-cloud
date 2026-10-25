import { AdminPlansCase, AdminSubscriptionsCase, GetPlansCase, GetUserPlansCase, SubscribeToPlanCase } from "@kumo/application";
import { InfraPlan, InfraPlanRepository, InfraUserRepository, StripeProvider } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PlanSubscriptionsController } from "../controllers/PlanSubscriptions.controller.js";
import { UserSubscriptionsController } from "../controllers/UserSubscriptions.controller.js";
import { PlansController } from "../controllers/Plans.controller.js";
import { UserPlansController } from "../controllers/UserPlans.controller.js";
import { DatabaseModule } from "./Database.module.js";
import { StripeModule } from "./Stripe.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { createPlanCheckoutRedirects } from "../common/PlanCheckout.options.js";

@Module({
  imports: [AppConfigModule, DatabaseModule, StripeModule, TypeOrmModule.forFeature([InfraPlan])],
  controllers: [UserPlansController, PlansController, PlanSubscriptionsController, UserSubscriptionsController],
  providers: [
    { provide: AdminPlansCase, useFactory: (plans: InfraPlanRepository): AdminPlansCase => new AdminPlansCase(plans), inject: [InfraPlanRepository] },
    { provide: AdminSubscriptionsCase, useFactory: (users: InfraUserRepository, stripe: StripeProvider): AdminSubscriptionsCase => new AdminSubscriptionsCase(users, stripe), inject: [InfraUserRepository, StripeProvider] },
    {
      provide: InfraPlanRepository,
      useFactory: (repository: Repository<InfraPlan>): InfraPlanRepository => new InfraPlanRepository(repository),
      inject: [getRepositoryToken(InfraPlan)],
    },
    {
      provide: GetPlansCase,
      useFactory: (plans: InfraPlanRepository): GetPlansCase => new GetPlansCase(plans),
      inject: [InfraPlanRepository],
    },
    {
      provide: GetUserPlansCase,
      useFactory: (users: InfraUserRepository, plans: InfraPlanRepository, stripe: StripeProvider): GetUserPlansCase => new GetUserPlansCase(users, plans, stripe),
      inject: [InfraUserRepository, InfraPlanRepository, StripeProvider],
    },
    {
      provide: SubscribeToPlanCase,
      useFactory: (users: InfraUserRepository, plans: InfraPlanRepository, stripe: StripeProvider, config: ConfigService): SubscribeToPlanCase =>
        new SubscribeToPlanCase(users, plans, stripe, createPlanCheckoutRedirects(config.getOrThrow<string>("FRONTEND_URL"))),
      inject: [InfraUserRepository, InfraPlanRepository, StripeProvider, ConfigService],
    },
  ],
  exports: [InfraPlanRepository],
})
export class PlanModule {}
