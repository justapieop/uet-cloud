import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
  envFilePath,
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
  exports: [ConfigModule],
})
export class AppConfigModule { }
