import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
  FEATURE_FLAGS,
  envFilePath,
  featureFlagsProvider,
  loadAzureConfiguration,
  loadRuntimeConfiguration,
  useAzureConfiguration,
} from "./provider.js";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      expandVariables: false,
      isGlobal: true,
      ignoreEnvFile: useAzureConfiguration,
      envFilePath,
      load: useAzureConfiguration
        ? [loadAzureConfiguration, loadRuntimeConfiguration]
        : [loadRuntimeConfiguration],
    }),
  ],
  providers: [featureFlagsProvider],
  exports: [ConfigModule, FEATURE_FLAGS],
})
export class AppConfigModule { }
