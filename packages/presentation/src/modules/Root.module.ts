import { Module } from "@nestjs/common";
import { AppConfigModule, DatabaseModule } from "@kumo/infrastructure";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
  ],
})
export class RootModule { }

