import { Module } from "@nestjs/common";
import { AuthController } from "../controllers/Auth.controller.js";
import { AuthModule } from "./Auth.module.js";
import { AppConfigModule } from "./AppConfig.module.js";
import { FeatureModule } from "./Feature.module.js";

@Module({
  imports: [
    AppConfigModule,
    FeatureModule,
    AuthModule,
  ],
  controllers: [AuthController],
})
export class RootModule { }
