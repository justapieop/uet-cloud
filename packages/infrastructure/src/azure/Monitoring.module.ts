import { Module } from "@nestjs/common";
import { AzureMonitorMetricsReader } from "./monitoring.js";

@Module({ providers: [AzureMonitorMetricsReader], exports: [AzureMonitorMetricsReader] })
export class AzureMonitoringModule {}
