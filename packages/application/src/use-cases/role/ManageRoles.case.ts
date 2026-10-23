import { Role } from "@kumo/domain";
import {
  RoleManagementNotFound,
} from "../../ports/role.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import {
  assertCanGrant,
  assertRoleManageRetained,
  knownPermissionMask,
  unionRoleBits,
} from "./permissions.js";

export interface RoleWriteInput {
  readonly id: string;
  readonly name: string;
  readonly permission: bigint;
  readonly active: boolean;
}

export class ManageRolesCase {
  public constructor(private readonly uow: UnitOfWork) {}

  public create(input: RoleWriteInput, actorId: string): Promise<Role> {
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<Role> => {
      const actorBits: bigint = await this.actorBits(repositories, actorId);
      assertCanGrant(actorBits, input.permission);

      const role: Role = new Role(input);
      await repositories.roles.insert(role);

      return role;
    });
  }

  public replace(input: RoleWriteInput, actorId: string): Promise<Role> {
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<Role> => {
      const existing: Role | null = await repositories.roles.findById(input.id);
      if (!existing) {
        throw new RoleManagementNotFound("Role not found");
      }

      const actorRoles: Role[] = await repositories.roles.findActiveByUserId(actorId);
      const actorBits: bigint = unionRoleBits(actorRoles);
      assertCanGrant(actorBits, existing.getPermissionBits());

      const permission: bigint = input.permission | (existing.getPermissionBits() & ~knownPermissionMask());
      const role: Role = new Role({
        id: existing.id,
        name: input.name,
        permission,
        active: input.active,
        createdAt: existing.createdAt,
      });

      assertCanGrant(actorBits, role.getPermissionBits());
      assertRoleManageRetained(actorRoles, role.id, role.active ? role.getPermissionBits() : null);

      await repositories.roles.replace(role);

      return role;
    });
  }

  public deactivate(id: string, actorId: string): Promise<Role> {
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<Role> => {
      const existing: Role | null = await repositories.roles.findById(id);
      if (!existing) {
        throw new RoleManagementNotFound("Role not found");
      }

      const actorRoles: Role[] = await repositories.roles.findActiveByUserId(actorId);
      const actorBits: bigint = unionRoleBits(actorRoles);
      assertCanGrant(actorBits, existing.getPermissionBits());
      assertRoleManageRetained(actorRoles, existing.id, null);

      await repositories.roles.deactivate(id);

      return new Role({
        id: existing.id,
        name: existing.name,
        permission: existing.getPermissionBits(),
        active: false,
        createdAt: existing.createdAt,
      });
    });
  }

  private async actorBits(repositories: UnitOfWorkRepositories, actorId: string): Promise<bigint> {
    const roles: Role[] = await repositories.roles.findActiveByUserId(actorId);
    return unionRoleBits(roles);
  }
}
