import { RoleManagementConflict, RoleManagementForbidden, RoleManagementNotFound } from "@kumo/application";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";

export function roleManagementError(error: unknown): never {
  if (error instanceof RoleManagementNotFound) throw new NotFoundException(error.message);
  if (error instanceof RoleManagementConflict) throw new ConflictException(error.message);
  if (error instanceof RoleManagementForbidden) throw new ForbiddenException(error.message);
  throw error;
}
