import { Domain, InvalidDomainParams } from "./domain.js";
import { Permission, type PermissionDefinition } from "./permission.js";
import { isBlankStr } from "./utils.js";

export { Permission, type PermissionDefinition } from "./permission.js";

export class Role extends Domain<RoleDetails> {
  public readonly id: string;
  public readonly name: string;
  private readonly permission: bigint;
  public readonly createdAt: Date;

  public constructor(details: RoleDetails) {
    super(details);

    this.id = details.id;
    this.name = details.name;
    this.permission = details.permission ?? 0n;
    this.createdAt = details.createdAt ?? new Date();
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) {
      return new InvalidDomainParams(`Role.id must not be blank`);
    }

    if (isBlankStr(this.details.name)) {
      return new InvalidDomainParams(`Role.name must not be blank`);
    }

    if (this.details.permission !== undefined &&
      (typeof this.details.permission !== "bigint" || this.details.permission < 0n)) {
      return new InvalidDomainParams(`Role.permission must be a non-negative bigint`);
    }

    return null;
  }

  public hasPermission(permission: Permission): boolean {
    if (!Number.isSafeInteger(permission.offset) || permission.offset < 0) {
      return false;
    }

    const superMask: bigint = 1n << BigInt(Permission.Super.offset);

    if ((this.permission & superMask) === superMask) {
      return true;
    }

    const requiredMask: bigint = 1n << BigInt(permission.offset);

    return (this.permission & requiredMask) === requiredMask;
  }

  public getGrantedPermissions(): PermissionDefinition[] {
    return Object.values(Permission).filter(
      (permission: Permission): boolean => this.hasPermission(permission),
    );
  }

  public getPermissionBits(): bigint {
    return this.permission;
  }
}

export interface RoleDetails {
  id: string;
  name: string;
  permission?: bigint;
  createdAt?: Date;
}
