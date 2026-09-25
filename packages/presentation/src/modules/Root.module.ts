import { Module } from "@nestjs/common";
import { configModule } from "@kumo/infrastructure";

@Module({
  imports: [configModule],
})
export class RootModule { }
