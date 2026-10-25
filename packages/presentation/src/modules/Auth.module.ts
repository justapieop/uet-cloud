import { Module } from "@nestjs/common";
import { AuthController } from "../controllers/Auth.controller.js";
import { PassportProvider, SessionSerializer } from "@kumo/infrastructure";
import { InfraSessionAuthorizationReader } from "@kumo/infrastructure";
import { SESSION_AUTHORIZATION_READER } from "@kumo/application";
import { DataSource } from "typeorm";
import { UserModule } from "./User.module.js";
import { PassportModule } from "@nestjs/passport";
import { GitHubModule } from "./GitHub.module.js";

@Module({
  imports: [
    PassportModule.register({ session: true, }),
    UserModule,
    GitHubModule,
  ],
  providers: [
    PassportProvider,
    SessionSerializer,
    {
      provide: SESSION_AUTHORIZATION_READER,
      useFactory: (source: DataSource): InfraSessionAuthorizationReader => new InfraSessionAuthorizationReader(source),
      inject: [DataSource],
    },
  ],
  controllers: [
    AuthController,
  ],
})
export class AuthModule { }
