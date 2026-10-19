import { StripeProvider } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { AppConfigModule } from "./AppConfig.module.js";

@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: Stripe,
      useFactory: (config: ConfigService): Stripe =>
        new Stripe(config.getOrThrow<string>("STRIPE_SECRET_KEY")),
      inject: [ConfigService],
    },
    {
      provide: StripeProvider,
      useFactory: (client: Stripe): StripeProvider => new StripeProvider(client),
      inject: [Stripe],
    },
  ],
  exports: [StripeProvider],
})
export class StripeModule {}
