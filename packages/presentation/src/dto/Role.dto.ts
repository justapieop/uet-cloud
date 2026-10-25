import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsString, Matches, MaxLength } from "class-validator";
import type { RoleWriteInput } from "@kumo/application";
import { Permission, type PermissionDefinition, type Role, type User } from "@kumo/domain";
import { UserResponseDto } from "./User.dto.js";

const PERMISSION_ENTRIES: readonly (readonly [string, PermissionDefinition])[] = Object.entries(Permission)
  .sort((left: [string, PermissionDefinition], right: [string, PermissionDefinition]): number => left[1].offset - right[1].offset)
  .map(([key, permission]: [string, PermissionDefinition]): readonly [string, PermissionDefinition] => [key, permission]);

const PERMISSION_KEYS: ReadonlyMap<PermissionDefinition, string> = new Map<PermissionDefinition, string>(
  PERMISSION_ENTRIES.map(([key, permission]: readonly [string, PermissionDefinition]): [PermissionDefinition, string] => [permission, key]),
);

const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map<string, PermissionDefinition>(
  PERMISSION_ENTRIES.map(([key, permission]: readonly [string, PermissionDefinition]): [string, PermissionDefinition] => [key, permission]),
);

export const STORED_PERMISSION_KEYS: readonly string[] = PERMISSION_ENTRIES.map(
  ([key]: readonly [string, PermissionDefinition]): string => key,
);
const MAX_ROLE_ASSIGNMENTS: number = 100;

function permissionKey(permission: PermissionDefinition): string {
  const key: string | undefined = PERMISSION_KEYS.get(permission);
  if (key === undefined) {
    throw new Error(`Unknown permission definition: ${permission.name}`);
  }
  return key;
}

export function permissionBits(keys: readonly string[]): bigint {
  return keys.reduce((bits: bigint, key: string): bigint => {
    const permission: PermissionDefinition | undefined = PERMISSION_BY_KEY.get(key);
    if (!permission) {
      throw new Error(`Unknown permission key: ${key}`);
    }
    return bits | (1n << BigInt(permission.offset));
  }, 0n);
}

export function roleWriteInput(id: string, dto: RoleWriteDto): RoleWriteInput {
  return {
    id,
    name: dto.name,
    active: dto.active,
    permission: permissionBits(dto.permissions),
  };
}

@Exclude()
export class PermissionResponseDto {
  public constructor(key: string, permission: PermissionDefinition) {
    this.key = key;
    this.name = permission.name;
    this.description = permission.description;
    this.requires = permission.requires.map((required: PermissionDefinition): string => permissionKey(required));
  }

  @Expose()
  @ApiProperty({ description: "Stable permission key used by role write operations" })
  public readonly key: string;

  @Expose()
  @ApiProperty()
  public readonly name: string;

  @Expose()
  @ApiProperty()
  public readonly description: string;

  @Expose()
  @ApiProperty({ type: [String], description: "Permission keys that should accompany this permission" })
  public readonly requires: string[];
}

@Exclude()
export class RoleResponseDto {
  public constructor(role: Role) {
    this.id = role.id;
    this.name = role.name;
    this.active = role.active;
    this.permissions = role.getStoredPermissions().map((permission: PermissionDefinition): string => permissionKey(permission));
    this.createdAt = role.createdAt;
  }

  @Expose()
  @ApiProperty()
  public readonly id: string;

  @Expose()
  @ApiProperty()
  public readonly name: string;

  @Expose()
  @ApiProperty()
  public readonly active: boolean;

  @Expose()
  @ApiProperty({ type: [String], description: "Exact stored permission keys; Super does not expand into every permission" })
  public readonly permissions: string[];

  @Expose({ name: "created_at" })
  @ApiProperty({ name: "created_at" })
  public readonly createdAt: Date;
}

@Exclude()
export class RoleCatalogResponseDto {
  public constructor(roles: readonly Role[], permissions: readonly PermissionDefinition[]) {
    this.roles = roles.map((role: Role): RoleResponseDto => new RoleResponseDto(role));
    this.permissions = permissions.map(
      (permission: PermissionDefinition): PermissionResponseDto => new PermissionResponseDto(permissionKey(permission), permission),
    );
  }

  @Expose()
  @Type(() => RoleResponseDto)
  @ApiProperty({ type: [RoleResponseDto] })
  public readonly roles: RoleResponseDto[];

  @Expose()
  @Type(() => PermissionResponseDto)
  @ApiProperty({ type: [PermissionResponseDto] })
  public readonly permissions: PermissionResponseDto[];
}

export class RoleWriteDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  public name!: string;

  @ApiProperty()
  @IsBoolean()
  public active!: boolean;

  @ApiProperty({
    type: [String],
    description: "Exact permission keys from the catalog. Unknown keys and duplicates are rejected.",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(STORED_PERMISSION_KEYS.length)
  @IsString({ each: true })
  @IsIn(STORED_PERMISSION_KEYS, { each: true })
  public permissions!: string[];
}

export class RoleCreateDto extends RoleWriteDto {
  @ApiProperty({ description: "Stable role identifier" })
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  public id!: string;
}

export class UserRoleWriteDto {
  @ApiProperty({ type: [String], description: "Exact replacement set of role IDs" })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_ROLE_ASSIGNMENTS)
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  @MaxLength(255, { each: true })
  public role_ids!: string[];
}

@Exclude()
export class UserRolesResponseDto {
  public constructor(user: User, roles: readonly Role[]) {
    this.user = new UserResponseDto(user);
    this.roles = roles.map((role: Role): RoleResponseDto => new RoleResponseDto(role));
  }

  @Expose()
  @Type(() => UserResponseDto)
  @ApiProperty({ type: UserResponseDto })
  public readonly user: UserResponseDto;

  @Expose()
  @Type(() => RoleResponseDto)
  @ApiProperty({ type: [RoleResponseDto] })
  public readonly roles: RoleResponseDto[];
}
