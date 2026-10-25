import { Permission, type PermissionDefinition, type Role } from "@kumo/domain";
import { RoleManagementForbidden } from "../../ports/role.js";

const SUPER_MASK: bigint = 1n << BigInt(Permission.Super.offset);
const ROLE_MANAGE_MASK: bigint = 1n << BigInt(Permission.RoleManage.offset);
const KNOWN_PERMISSION_MASK: bigint = Object.values(Permission).reduce(
  (bits: bigint, permission: PermissionDefinition): bigint => bits | (1n << BigInt(permission.offset)),
  0n,
);

export function unionRoleBits(roles: readonly Role[]): bigint {
  return roles.reduce((bits: bigint, role: Role): bigint => bits | role.getPermissionBits(), 0n);
}

export function hasSuper(bits: bigint): boolean {
  return (bits & SUPER_MASK) === SUPER_MASK;
}

export function hasRoleManage(bits: bigint): boolean {
  return hasSuper(bits) || (bits & ROLE_MANAGE_MASK) === ROLE_MANAGE_MASK;
}

export function knownPermissionMask(): bigint {
  return KNOWN_PERMISSION_MASK;
}

export function assertCanGrant(actorBits: bigint, grantedBits: bigint): void {
  if (grantedBits < 0n) {
    throw new RoleManagementForbidden("A role cannot contain negative permission bits");
  }

  if (!hasSuper(actorBits) && (grantedBits & ~actorBits) !== 0n) {
    throw new RoleManagementForbidden("You cannot grant permissions you do not hold");
  }
}

export function assertRoleManageRetained(
  actorRoles: readonly Role[],
  targetRoleId: string,
  replacementBits: bigint | null,
): void {
  const assigned: boolean = actorRoles.some((role: Role): boolean => role.id === targetRoleId);
  if (!assigned) {
    return;
  }

  const remaining: bigint = actorRoles
    .filter((role: Role): boolean => role.id !== targetRoleId)
    .reduce(
      (bits: bigint, role: Role): bigint => bits | role.getPermissionBits(),
      replacementBits ?? 0n,
    );

  if (!hasRoleManage(remaining)) {
    throw new RoleManagementForbidden("You cannot remove your own role management access");
  }
}
