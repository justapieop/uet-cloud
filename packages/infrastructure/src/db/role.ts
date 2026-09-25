import type { RoleRepository } from "@kumo/application";
import { Role } from "@kumo/domain";
import { Column, CreateDateColumn, Entity, PrimaryColumn, Repository } from "typeorm";

export class InfraRoleRepository implements RoleRepository {
  public constructor(
    private readonly roleRepository: Repository<InfraRole>,
  ) { }

  public async findById(id: string): Promise<Role | null> {
    const dbRole: InfraRole | null = await this.roleRepository.findOneBy({ id });

    if (!dbRole) {
      return null;
    }

    return new Role({
      id: dbRole.id,
      name: dbRole.name,
      permission: dbRole.permission,
      createdAt: dbRole.createdAt,
    });
  }

  public async save(role: Role): Promise<void> {
    const permissionBits: bigint = role.getPermissionBits();

    if (permissionBits > (1n << 63n) - 1n) {
      throw new RangeError("Role permissions exceed the SQL Server bigint range");
    }

    const dbRole: InfraRole = this.roleRepository.create({
      id: role.id,
      name: role.name,
      permission: permissionBits,
      createdAt: role.createdAt,
    });

    await this.roleRepository.save(dbRole);
  }
}

@Entity({
  name: "roles",
})
export class InfraRole {
  @PrimaryColumn({
    type: "nvarchar",
    length: 255,
  })
  public readonly id!: string;

  @Column({
    type: "nvarchar",
    length: 255,
    nullable: false,
  })
  public readonly name!: string;

  @CreateDateColumn({
    type: "datetime2",
    name: "created_at",
  })
  public readonly createdAt!: Date;

  @Column({
    type: "bigint",
    nullable: false,
    default: 0,
    transformer: {
      to(value: bigint): bigint {
        return value;
      },
      from(value: string | bigint): bigint {
        return BigInt(value);
      },
    },
  })
  public readonly permission!: bigint;
}
