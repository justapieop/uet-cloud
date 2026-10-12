import { Global, Module } from "@nestjs/common";
import { AppConfigModule } from "./AppConfig.module.js";
import { FEATURE_FLAGS, FeatureFlagsService, featureFlagsProvider, featureFlagsTokenProvider } from "@kumo/infrastructure";

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [featureFlagsProvider, featureFlagsTokenProvider],
  exports: [FEATURE_FLAGS, FeatureFlagsService],
})
export class FeatureModule { }
