import type { Role, User } from "@kumo/domain";
import {
  RoleManagementConflict,
  RoleManagementForbidden,
  RoleManagementNotFound,
} from "../../ports/role.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import {
  assertCanGrant,
  hasRoleManage,
  unionRoleBits,
} from "./permissions.js";
import type { UserRoleAssignments } from "./GetUserRoleAssignments.case.js";

export interface ReplaceUserRolesInput {
  readonly actorId: string;
  readonly userId: string;
  readonly roleIds: readonly string[];
}

export class ReplaceUserRolesCase {
  public constructor(private readonly uow: UnitOfWork) {}

  public exec(input: ReplaceUserRolesInput): Promise<UserRoleAssignments> {
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<UserRoleAssignments> => {
      const user: User | null = await repositories.users.findById(input.userId);
      if (!user) {
        throw new RoleManagementNotFound("User not found");
      }

      const uniqueIds: string[] = [...new Set(input.roleIds)];
      if (uniqueIds.length !== input.roleIds.length) {
        throw new RoleManagementConflict("Role assignments must be unique");
      }

      const roles: Role[] = await repositories.roles.findByIds(uniqueIds);
      if (roles.length !== uniqueIds.length) {
        throw new RoleManagementNotFound("One or more roles were not found");
      }
      if (roles.some((role: Role): boolean => !role.active)) {
        throw new RoleManagementConflict("Inactive roles cannot be assigned");
      }

      const actorRoles: Role[] = await repositories.roles.findActiveByUserId(input.actorId);
      const actorBits: bigint = unionRoleBits(actorRoles);
      for (const role of roles) {
        assertCanGrant(actorBits, role.getPermissionBits());
      }

      const currentRoles: Role[] = await repositories.userRoles.findByUserId(input.userId);
      const nextIds: ReadonlySet<string> = new Set(uniqueIds);
      for (const role of currentRoles) {
        if (role.active && !nextIds.has(role.id)) {
          assertCanGrant(actorBits, role.getPermissionBits());
        }
      }

      if (input.actorId === input.userId && !hasRoleManage(unionRoleBits(roles))) {
        throw new RoleManagementForbidden("You cannot remove your own role management access");
      }

      await repositories.userRoles.replaceForUser(input.userId, uniqueIds);

      const assignedRoles: Role[] = await repositories.userRoles.findByUserId(input.userId);

      return { user, roles: assignedRoles };
    });
  }
}
