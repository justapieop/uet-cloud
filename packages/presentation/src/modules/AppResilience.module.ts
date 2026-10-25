import { resilienceOptions, ResilienceTelemetry } from "@kumo/infrastructure";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ResilienceModule, type ResilienceModuleOptions } from "@nestjs/resilience";
import { AppConfigModule } from "./AppConfig.module.js";

@Module({
  imports: [ResilienceModule.forRootAsync({
    imports: [AppConfigModule],
    useFactory: (config: ConfigService): ResilienceModuleOptions => resilienceOptions(config),
    inject: [ConfigService],
  })],
  providers: [ResilienceTelemetry],
  exports: [ResilienceModule],
})
export class AppResilienceModule {}
