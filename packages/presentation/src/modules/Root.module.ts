import { AppIdempotencyModule } from "./AppIdempotency.module.js";
import { AppResilienceModule } from "./AppResilience.module.js";
import { Module } from "@nestjs/common";
import { AuthModule } from "./Auth.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { FeatureModule } from "./Feature.module.js";
import { DeploymentModule } from "./Deployment.module.js";
import { LoggerModule } from "nestjs-pino";
import { ConfigService } from "@nestjs/config";
import { AppCacheModule } from "./AppCache.module.js";
import { MonitoringModule } from "./Monitoring.module.js";

@Module({
  imports: [
    AppConfigModule,
    AppIdempotencyModule,
    AppResilienceModule,
    FeatureModule,
    LoggerModule.forRootAsync({
      imports: [
        AppConfigModule,
      ],
      useFactory: (config: ConfigService) => {
        const devMode: boolean = ["development", "test"].includes(config.get<string>("NODE_ENV", "production"));
        return {
          pinoHttp: {
            redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
            level: devMode ? "debug" : "info",
            quietReqLogger: devMode,
            quietResLogger: devMode,
          },
        };
      },
      inject: [
        ConfigService,
      ],
    }),
    AuthModule,
    DeploymentModule,
    MonitoringModule,
    AppCacheModule,
  ],
})
export class RootModule { }

