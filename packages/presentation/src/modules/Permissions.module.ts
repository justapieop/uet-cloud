import { CheckPermissionsCase } from "@kumo/application";
import { InfraRoleRepository } from "@kumo/infrastructure";
import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "./Database.module.js";
import { PermissionsGuard } from "../common/Permissions.guard.js";

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    PermissionsGuard,
    {
      provide: CheckPermissionsCase,
      useFactory: (roles: InfraRoleRepository): CheckPermissionsCase => new CheckPermissionsCase(roles),
      inject: [InfraRoleRepository],
    },
  ],
  exports: [CheckPermissionsCase, PermissionsGuard],
})
export class PermissionsModule {}
