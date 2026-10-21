import { CheckPermissionsCase } from "@kumo/application";
import type { PermissionDefinition, User } from "@kumo/domain";
import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { REQUIRED_PERMISSIONS } from "./Permissions.metadata.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector, private readonly permissions: CheckPermissionsCase) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const user: User | undefined = request.user as User | undefined;
    if (!request.isAuthenticated?.() || !user || user.suspended || !user.active) throw new ForbiddenException();
    // Controller and route requirements are additive; routes cannot weaken controller policy.
    const required: PermissionDefinition[] = this.reflector.getAllAndMerge<PermissionDefinition[]>(REQUIRED_PERMISSIONS, [context.getClass(), context.getHandler()]);
    if (!await this.permissions.exec(user.id, required)) throw new ForbiddenException("Required permissions are missing");
    return true;
  }
}
