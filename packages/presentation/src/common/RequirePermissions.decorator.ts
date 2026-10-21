import type { PermissionDefinition } from "@kumo/domain";
import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { PermissionsGuard } from "./Permissions.guard.js";
import { REQUIRED_PERMISSIONS } from "./Permissions.metadata.js";

export function RequirePermissions(...permissions: PermissionDefinition[]): ClassDecorator & MethodDecorator {
  return applyDecorators(SetMetadata(REQUIRED_PERMISSIONS, Object.freeze([...permissions])), UseGuards(PermissionsGuard));
}
