import { Module } from "@nestjs/common";
import { AuthController } from "../controllers/Auth.controller.js";
import { PassportProvider, SessionSerializer } from "@kumo/infrastructure";
import { UserModule } from "./User.module.js";
import { PassportModule } from "@nestjs/passport";

@Module({
  imports: [
    PassportModule.register({ session: true, }),
    UserModule,
  ],
  providers: [
    PassportProvider,
    SessionSerializer,
  ],
  controllers: [
    AuthController,
  ],
})
export class AuthModule { }
