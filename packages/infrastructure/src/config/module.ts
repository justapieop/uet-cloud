import type { DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { FEATURE_FLAGS } from "./feature-flags.js";
import {
  envFilePath,
  featureFlagsProvider,
  loadAzureConfiguration,
  loadRuntimeConfiguration,
  useAzureConfiguration,
} from "./provider.js";

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
