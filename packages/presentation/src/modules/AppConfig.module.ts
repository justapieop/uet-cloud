import { envFilePath, loadAzureConfiguration, loadRuntimeConfiguration, useAzureConfiguration } from "@kumo/infrastructure";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

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
