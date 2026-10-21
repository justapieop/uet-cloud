import { Permission, type PermissionDefinition, type Role } from "@kumo/domain";
import type { RoleRepository } from "../../ports/role.js";

export class CheckPermissionsCase {
  public constructor(private readonly roles: Pick<RoleRepository, "findActiveByUserId">) {}

  public async exec(userId: string, required: readonly PermissionDefinition[]): Promise<boolean> {
    if (required.some((permission: PermissionDefinition): boolean => !Number.isSafeInteger(permission.offset) || permission.offset < 0)) return false;
    if (required.length === 0) return true;
    const roles: Role[] = await this.roles.findActiveByUserId(userId);
    let granted: bigint = 0n;
    for (let index: number = 0; index < roles.length; index += 1) {
      const role: Role = roles[index]!;
      if (role.active) granted |= role.getPermissionBits();
    }
    const superMask: bigint = 1n << BigInt(Permission.Super.offset);
    if ((granted & superMask) === superMask) return true;
    let requiredMask: bigint = 0n;
    for (let index: number = 0; index < required.length; index += 1) {
      requiredMask |= 1n << BigInt(required[index]!.offset);
    }
    return (granted & requiredMask) === requiredMask;
  }
}
