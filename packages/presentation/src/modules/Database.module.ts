import { Logger, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { UNIT_OF_WORK } from "@kumo/application";
import { UserUseCases } from "@kumo/application";
import { InfraRole, InfraRoleRepository, InfraUser, InfraUserRepository, TypeOrmLoggerAdapter, TypeOrmUnitOfWork } from "@kumo/infrastructure";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
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
          logger: new TypeOrmLoggerAdapter(new Logger("TypeORM")),
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([InfraUser, InfraRole]),
  ],
  providers: [
    InfraUserRepository,
    InfraRoleRepository,
    TypeOrmUnitOfWork,
    {
      provide: UNIT_OF_WORK,
      useExisting: TypeOrmUnitOfWork,
    },
    UserUseCases,
  ],
  exports: [
    UNIT_OF_WORK,
    UserUseCases,
  ]
})
export class DatabaseModule { }
