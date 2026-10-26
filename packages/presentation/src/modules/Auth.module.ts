import { Module } from "@nestjs/common";
import { AuthController } from "../controllers/Auth.controller.js";
import { PassportProvider, SessionSerializer } from "@kumo/infrastructure";
import { InfraSessionAuthorizationReader } from "@kumo/infrastructure";
import { SESSION_AUTHORIZATION_READER } from "@kumo/application";
import { DataSource } from "typeorm";
import { UserModule } from "./User.module.js";
import { PassportModule } from "@nestjs/passport";
import { GitHubModule } from "./GitHub.module.js";
import { RootLoginCase, UNIT_OF_WORK, type UnitOfWork } from "@kumo/application";
import { RootPasswordAuthentication } from "@kumo/infrastructure";
import { ConfigService } from "@nestjs/config";
import { DatabaseModule } from "./Database.module.js";
import { RootLoginController } from "../controllers/RootLogin.controller.js";

@Module({
  imports: [
    PassportModule.register({ session: true, }),
    UserModule,
    GitHubModule,
    DatabaseModule,
  ],
  providers: [
    PassportProvider,
    SessionSerializer,
    {
      provide: RootPasswordAuthentication,
      useFactory: (config: ConfigService, source: DataSource): Promise<RootPasswordAuthentication> => RootPasswordAuthentication.create(config, source),
      inject: [ConfigService, DataSource],
    },
    {
      provide: RootLoginCase,
      useFactory: (uow: UnitOfWork, verifier: RootPasswordAuthentication): RootLoginCase => new RootLoginCase(uow, verifier),
      inject: [UNIT_OF_WORK, RootPasswordAuthentication],
    },
    {
      provide: SESSION_AUTHORIZATION_READER,
      useFactory: (source: DataSource): InfraSessionAuthorizationReader => new InfraSessionAuthorizationReader(source),
      inject: [DataSource],
    },
  ],
  controllers: [
    AuthController,
    RootLoginController,
  ],
})
export class AuthModule { }
