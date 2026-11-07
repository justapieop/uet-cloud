import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { DataSource, TypeORMError } from "typeorm";
import {
  DEPLOYMENT_OPERATION_LOCK,
  DEPLOYMENT_RESOURCE_UPDATE_REPOSITORY,
  DEPLOYMENT_RESOURCE_UPDATE_QUEUE,
  UNIT_OF_WORK,
} from "@kumo/application";
import {
  InfraDeployment,
  InfraScaleRule,
  InfraScaleRuleRepository,
  DATABASE_MIGRATIONS,
  InfraDeploymentOperationLock,
  InfraDeploymentRepository,
  InfraDeploymentResourceUpdate,
  InfraDeploymentResourceUpdateRepository,
  InfraPlan,
  InfraRole,
  InfraRoleRepository,
  InfraUser,
  InfraUserRole,
  InfraUserRoleRepository,
  InfraUserRepository,
  InfraVolume,
  InfraVolumeRepository,
  InfraStripeCustomerLinkRepository,
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

        const connectionUrl: string | undefined = config.get<string>("DATABASE_CONNECTION_URL");
        const connectionOptions: { url: string } | { host: string; port: number; database: string } = connectionUrl
          ? { url: connectionUrl }
          : {
              host: config.getOrThrow<string>("DATABASE_URL"),
              port: Number(config.getOrThrow<string>("DATABASE_PORT")),
              database: config.getOrThrow<string>("DATABASE_NAME"),
            };

        return {
          type: "mssql",
          ...connectionOptions,
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
    TypeOrmModule.forFeature([InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraDeploymentResourceUpdate, InfraPlan, InfraVolume, InfraScaleRule]),
  ],
  providers: [
    InfraUserRepository,
    InfraRoleRepository,
    InfraUserRoleRepository,
    InfraDeploymentRepository,
    InfraScaleRuleRepository,
    {
      provide: InfraDeploymentResourceUpdateRepository,
      useFactory: (dataSource: DataSource): InfraDeploymentResourceUpdateRepository => new InfraDeploymentResourceUpdateRepository(dataSource.manager),
      inject: [DataSource],
    },
    { provide: DEPLOYMENT_RESOURCE_UPDATE_REPOSITORY, useExisting: InfraDeploymentResourceUpdateRepository },
    { provide: DEPLOYMENT_RESOURCE_UPDATE_QUEUE, useExisting: InfraDeploymentResourceUpdateRepository },
    {
      provide: DEPLOYMENT_OPERATION_LOCK,
      useFactory: (dataSource: DataSource, config: ConfigService): InfraDeploymentOperationLock => {
        const timeoutMs: number = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
        return new InfraDeploymentOperationLock(dataSource, timeoutMs + 120_000);
      },
      inject: [DataSource, ConfigService],
    },
    InfraVolumeRepository,
    TypeOrmUnitOfWork,
    InfraStripeCustomerLinkRepository,
    {
      provide: UNIT_OF_WORK,
      useExisting: TypeOrmUnitOfWork,
    },
  ],
  exports: [
    InfraScaleRuleRepository,
    UNIT_OF_WORK,
    DEPLOYMENT_OPERATION_LOCK,
    InfraStripeCustomerLinkRepository,
    InfraDeploymentRepository,
    InfraDeploymentResourceUpdateRepository,
    DEPLOYMENT_RESOURCE_UPDATE_REPOSITORY,
    DEPLOYMENT_RESOURCE_UPDATE_QUEUE,
    InfraVolumeRepository,
    InfraUserRepository,
    InfraRoleRepository,
    InfraUserRoleRepository,
  ]
})
export class DatabaseModule { }
