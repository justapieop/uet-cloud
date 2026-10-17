import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AzureMonitorMetricsReader } from "./monitoring.js";

@Module({
  imports: [ConfigModule],
  providers: [{
    provide: AzureMonitorMetricsReader,
    useFactory: (config: ConfigService): AzureMonitorMetricsReader => new AzureMonitorMetricsReader(config),
    inject: [ConfigService],
  }],
  exports: [AzureMonitorMetricsReader],
})
export class AzureMonitoringModule {}
