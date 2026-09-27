import { Module } from "@nestjs/common";
import { AuthController } from "../controllers/Auth.controller.js";
import { PassportProvider } from "@kumo/infrastructure";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PassportProvider,
  ],
  controllers: [
    AuthController,
  ],
})
export class AuthModule { }
