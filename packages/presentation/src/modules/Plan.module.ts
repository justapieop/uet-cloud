import { GetPlansCase, SubscribeToPlanCase } from "@kumo/application";
import { InfraPlan, InfraPlanRepository, InfraUserRepository, StripeProvider } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PlanSubscriptionsController } from "../controllers/PlanSubscriptions.controller.js";
import { PlansController } from "../controllers/Plans.controller.js";
import { DatabaseModule } from "./Database.module.js";
import { StripeModule } from "./Stripe.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { createPlanCheckoutRedirects } from "../common/PlanCheckout.options.js";

@Module({
  imports: [AppConfigModule, DatabaseModule, StripeModule, TypeOrmModule.forFeature([InfraPlan])],
  controllers: [PlansController, PlanSubscriptionsController],
  providers: [
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
      provide: SubscribeToPlanCase,
      useFactory: (users: InfraUserRepository, plans: InfraPlanRepository, stripe: StripeProvider, config: ConfigService): SubscribeToPlanCase =>
        new SubscribeToPlanCase(users, plans, stripe, createPlanCheckoutRedirects(config.getOrThrow<string>("FRONTEND_URL"))),
      inject: [InfraUserRepository, InfraPlanRepository, StripeProvider, ConfigService],
    },
  ],
})
export class PlanModule {}
