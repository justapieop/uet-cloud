import type { RoleRepository } from "@kumo/application";
import { Role } from "@kumo/domain";
import { Column, CreateDateColumn, Entity, PrimaryColumn, Repository } from "typeorm";

export class PostgresRoleRepository implements RoleRepository {
  public constructor(
    private readonly roleRepository: Repository<PostgresRole>,
  ) { }

  public async findById(id: string): Promise<Role | null> {
    const dbRole: PostgresRole | null = await this.roleRepository.findOneBy({ id });

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
    const dbRole: PostgresRole = this.roleRepository.create({
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
export class PostgresRole {
  @PrimaryColumn({
    type: "text",
  })
  public readonly id!: string;

  @Column({
    type: "text",
    nullable: false,
  })
  public readonly name!: string;

  @CreateDateColumn({
    name: "created_at",
  })
  public readonly createdAt!: Date;

  @Column({
    type: "varbit",
    nullable: false,
    default: "0",
    transformer: {
      to(value: bigint): string {
        return value.toString(2);
      },
      from(value: string): bigint {
        return BigInt(`0b${value}`);
      },
    },
  })
  public readonly permission!: bigint;
}
