import type { DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
  envFilePath,
  FEATURE_FLAGS,
  featureFlagsProvider,
  loadAzureConfiguration,
  loadRuntimeConfiguration,
  useAzureConfiguration,
} from "@kumo/infrastructure";

async function createAppConfigModule(): Promise<DynamicModule> {
  const configModule: DynamicModule = await ConfigModule.forRoot({
    cache: true,
    expandVariables: false,
    isGlobal: true,
    ignoreEnvFile: useAzureConfiguration,
    envFilePath,
    load: useAzureConfiguration
      ? [loadAzureConfiguration, loadRuntimeConfiguration]
      : [loadRuntimeConfiguration],
  });

  return {
    ...configModule,
    providers: [...(configModule.providers ?? []), featureFlagsProvider],
    exports: [...(configModule.exports ?? []), FEATURE_FLAGS],
  };
}

export const AppConfigModule: Promise<DynamicModule> = createAppConfigModule();
