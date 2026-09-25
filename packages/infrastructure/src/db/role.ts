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
    const dbRole: InfraRole = this.roleRepository.create({
      id: role.id,
      name: role.name,
      permission: role.getPermissionBits(),
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
    type: "varchar",
    length: "MAX",
    nullable: false,
    default: "0",
    transformer: {
      to(value: bigint): string {
        return value.toString(10);
      },
      from(value: string): bigint {
        return BigInt(value);
      },
    },
  })
  public readonly permission!: bigint;
}
