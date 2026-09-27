import { Module } from "@nestjs/common";
import { PassportProvider } from "./provider.js";
import { DatabaseModule } from "../db/index.js";

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PassportProvider,
  ],
  exports: [
  ],
})
export class AuthModule { }
