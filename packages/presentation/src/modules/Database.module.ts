import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import {
  DEPLOYMENT_REPOSITORY,
  UNIT_OF_WORK,
  type UnitOfWork,
} from "@kumo/application";
import { CreateUserCase } from "@kumo/application";
import {
  InfraDeployment,
  InfraDeploymentRepository,
  InfraDeploymentSpec,
  InfraRole,
  InfraRoleRepository,
  InfraUser,
  InfraUserRepository,
  TypeOrmLoggerAdapter,
  TypeOrmUnitOfWork,
} from "@kumo/infrastructure";

@Module({
  imports: [
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
          migrationsTransactionMode: "all",
          migrations: ["packages/infrastructure/src/db/migrations"],
          logging: devMode ? "all" : undefined,
          logger: new TypeOrmLoggerAdapter(pinoLogger),
        };
      },
      inject: [ConfigService, PinoLogger],
    }),
    TypeOrmModule.forFeature([InfraUser, InfraRole, InfraDeployment, InfraDeploymentSpec]),
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
    {
      provide: DEPLOYMENT_REPOSITORY,
      useExisting: InfraDeploymentRepository,
    },
    {
      provide: CreateUserCase,
      useFactory: (unitOfWork: UnitOfWork): CreateUserCase => new CreateUserCase(unitOfWork),
      inject: [UNIT_OF_WORK],
    },
  ],
  exports: [
    UNIT_OF_WORK,
    DEPLOYMENT_REPOSITORY,
    CreateUserCase,
    InfraUserRepository,
    InfraRoleRepository,
  ]
})
export class DatabaseModule { }
