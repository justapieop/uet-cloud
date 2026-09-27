import { Module } from "@nestjs/common";
import { AppConfigModule } from "./Config.module.js";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
  ],
})
export class RootModule { }
