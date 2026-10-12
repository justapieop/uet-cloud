import { Module } from "@nestjs/common";
import { AuthModule } from "./Auth.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { FeatureModule } from "./Feature.module.js";
import { DeploymentModule } from "./Deployment.module.js";
import { LoggerModule } from "nestjs-pino";
import { ConfigService } from "@nestjs/config";
import { AppCacheModule } from "./AppCache.module.js";

@Module({
  imports: [
    AppConfigModule,
    FeatureModule,
    LoggerModule.forRootAsync({
      imports: [
        AppConfigModule,
      ],
      useFactory: (config: ConfigService) => {
        const devMode: boolean = ["development", "test"].includes(config.get<string>("NODE_ENV", "production"));
        return {
          pinoHttp: {
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
    AppCacheModule,
  ],
})
export class RootModule { }
