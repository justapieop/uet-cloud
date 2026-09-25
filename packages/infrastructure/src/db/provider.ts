import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppConfigModule } from "../config/provider.js";

export const DatabaseModule = TypeOrmModule.forRootAsync({
  imports: [AppConfigModule],
  useFactory: async (config: ConfigService) => {
    const devMode: boolean = config.get<string>("NODE_ENV", "production").trim().toLowerCase() === "development";
    const enableEncryption: boolean = config.get<string>("DATABASE_ENABLE_ENCRYPTION", "true").trim().toLowerCase() === "true";
    const port: number = Number(config.getOrThrow<string>("DATABASE_PORT"));

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("DATABASE_PORT must be an integer between 1 and 65535");
    }

    return {
      type: "mssql",
      host: config.getOrThrow<string>("DATABASE_URL"),
      port,
      database: config.getOrThrow("DATABASE_NAME"),
      synchronize: devMode,
      autoLoadEntities: true,
      cache: true,
      authentication: {
        type: "azure-active-directory-default",
        options: {},
      },
      options: {
        encrypt: enableEncryption,
      }
    };
  },
  inject: [ConfigService],
});
