import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export class Role extends Domain<RoleDetails> {
  public readonly id: string;
  public readonly name: string;
  private readonly permission: bigint;

  public constructor(details: RoleDetails) {
    super(details);

    this.id = details.id;
    this.name = details.name;
    this.permission = details.permission ?? BigInt(0);
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
    if (!Object.values(Permission).includes(permission)) {
      return false;
    }

    const superMask: bigint = 1n << BigInt(Permission.Super.offset);
    const requiredMask: bigint = 1n << BigInt(permission.offset);

    return (this.permission & superMask) === superMask ||
      (this.permission & requiredMask) === requiredMask;
  }

  public getGrantedPermissions(): Permission[] {
    return Object.values(Permission).filter(
      (permission: Permission): boolean => this.hasPermission(permission),
    );
  }
}

export interface PermissionDefinition {
  readonly offset: number;
  readonly name: string;
  readonly description: string;
}

export const Permission: Readonly<Record<"Super", PermissionDefinition>> = {
  Super: {
    offset: 0,
    name: "Super",
    description: "Super role that has all permission. Granting this permission is not recommended.",
  },
};

export type Permission = (typeof Permission)[keyof typeof Permission];

export interface RoleDetails {
  id: string;
  name: string;
  permission?: bigint;
}
