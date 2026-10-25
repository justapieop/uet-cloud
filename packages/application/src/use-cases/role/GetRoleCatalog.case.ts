import { Permission, type PermissionDefinition, type Role } from "@kumo/domain";
import type { RoleRepository } from "../../ports/role.js";

export interface RoleCatalog {
  readonly roles: readonly Role[];
  readonly permissions: readonly PermissionDefinition[];
}

export class GetRoleCatalogCase {
  public constructor(private readonly roles: Pick<RoleRepository, "findAll">) {}

  public async exec(): Promise<RoleCatalog> {
    const roles: Role[] = await this.roles.findAll();
    const permissions: PermissionDefinition[] = Object.values(Permission).sort(
      (left: PermissionDefinition, right: PermissionDefinition): number => left.offset - right.offset,
    );

    return { roles, permissions };
  }
}
