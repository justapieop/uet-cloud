import { Module } from "@nestjs/common";
import { AppConfigModule, DatabaseModule, FeatureFlagsModule } from "@kumo/infrastructure";

@Module({
  imports: [
    AppConfigModule,
    FeatureFlagsModule,
    DatabaseModule,
  ],
})
export class RootModule { }
