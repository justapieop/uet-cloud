import { StripeModule } from "./Stripe.module.js";
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
import { PermissionsModule } from "./Permissions.module.js";
import { PlanModule } from "./Plan.module.js";
import { RoleModule } from "./Role.module.js";
import { RegionsModule } from "./Regions.module.js";
import { GitHubWebhookModule } from "./GitHubWebhook.module.js";

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
            redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-hub-signature-256']", "res.headers['set-cookie']"],
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
    PermissionsModule,
    DeploymentModule,
    MonitoringModule,
    AppCacheModule,
    StripeModule,
    PlanModule,
    RoleModule,
    RegionsModule,
    GitHubWebhookModule,
  ],
})
export class RootModule { }

