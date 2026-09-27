import { Module } from "@nestjs/common";
import { AuthProvider } from "./provider.js";

@Module({
  providers: [AuthProvider],
  exports: [AuthProvider],
})
export class AuthModule { }
