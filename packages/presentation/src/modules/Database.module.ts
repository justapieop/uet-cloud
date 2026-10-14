import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { TypeORMError } from "typeorm";
import {
  UNIT_OF_WORK,
} from "@kumo/application";
import {
  InfraDeployment,
  DATABASE_MIGRATIONS,
  InfraDeploymentRepository,
  InfraRole,
  InfraRoleRepository,
  InfraUser,
  InfraUserRepository,
  TypeOrmLoggerAdapter,
  TypeOrmUnitOfWork,
} from "@kumo/infrastructure";
import { AppConfigModule } from "./AppConfig.module.js";

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      useFactory: async (config: ConfigService, pinoLogger: PinoLogger) => {
        const devMode: boolean = config.get<string>("NODE_ENV", "production").trim().toLowerCase() === "development";
        const enableEncryption: boolean = config.get<string>("DATABASE_ENABLE_ENCRYPTION", "true").trim().toLowerCase() === "true";

        return {
          type: "mssql",
          url: config.getOrThrow("DATABASE_CONNECTION_URL"),
          synchronize: false,
          autoLoadEntities: true,
          cache: true,
          authentication: {
            type: "azure-active-directory-default",
            options: {},
          },
          options: {
            encrypt: enableEncryption,
          },
          migrationsRun: true,
          // Migration and SQL failures need correction, not another startup attempt.
          toRetry: (error: unknown): boolean => !(error instanceof TypeORMError),
          migrationsTransactionMode: "all",
          migrations: DATABASE_MIGRATIONS,
          logging: devMode ? "all" : undefined,
          logger: new TypeOrmLoggerAdapter(pinoLogger),
        };
      },
      inject: [ConfigService, PinoLogger],
    }),
    TypeOrmModule.forFeature([InfraUser, InfraRole, InfraDeployment]),
  ],
  providers: [
    InfraUserRepository,
    InfraRoleRepository,
    InfraDeploymentRepository,
    TypeOrmUnitOfWork,
    {
      provide: UNIT_OF_WORK,
      useExisting: TypeOrmUnitOfWork,
    },
  ],
  exports: [
    UNIT_OF_WORK,
    InfraDeploymentRepository,
    InfraUserRepository,
    InfraRoleRepository,
  ]
})
export class DatabaseModule { }
