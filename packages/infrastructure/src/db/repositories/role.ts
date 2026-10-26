import { RoleManagementConflict, RoleManagementNotFound, type RoleRepository } from "@kumo/application";
import { Role } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, CreateDateColumn, Entity, In, PrimaryColumn, Repository } from "typeorm";

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

  @Column({ type: "bit", nullable: false, default: true })
  public readonly active!: boolean;

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

@Injectable()
export class InfraRoleRepository implements RoleRepository {
  public constructor(
    @InjectRepository(InfraRole)
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
      active: dbRole.active,
    });
  }

  public async findByIds(ids: readonly string[]): Promise<Role[]> {
    if (ids.length === 0) {
      return [];
    }

    const records: InfraRole[] = await this.roleRepository.find({
      where: { id: In([...ids]) },
      order: { id: "ASC" },
    });

    return records.map((record: InfraRole): Role => new Role({ ...record }));
  }

  public async findByIdForUpdate(id: string): Promise<Role | null> {
    // HOLDLOCK protects the missing-key range too, so concurrent signups cannot
    // both seed the default role. UPDLOCK avoids shared-to-exclusive upgrades.
    await this.roleRepository.manager.query(
      "SELECT id FROM roles WITH (UPDLOCK, HOLDLOCK) WHERE id = @0", [id]);
    return this.findById(id);
  }

  public async findAll(): Promise<Role[]> {
    const records: InfraRole[] = await this.roleRepository.find({
      order: {
        id: "ASC",
      },
    });

    return records.map((record: InfraRole): Role => new Role({ ...record }));
  }

  public async findActiveByUserId(userId: string): Promise<Role[]> {
    const records: InfraRole[] = await this.roleRepository.createQueryBuilder("role")
      .innerJoin("user_roles", "assignment", "assignment.role_id = role.id")
      .where("assignment.user_id = :userId", { userId })
      .andWhere("role.active = :active", { active: true })
      .orderBy("role.id", "ASC").getMany();
    return records.map((record: InfraRole): Role => new Role({ ...record }));
  }

  private record(role: Role): InfraRole {
    const permissionBits: bigint = role.getPermissionBits();

    if (permissionBits > (1n << 63n) - 1n) {
      throw new RangeError("Role permissions exceed the SQL Server bigint range");
    }

    return {
      id: role.id,
      name: role.name,
      permission: permissionBits,
      createdAt: role.createdAt,
      active: role.active,
    };
  }

  private writeError(error: unknown): never {
    const driver: unknown = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : error;
    if (typeof driver === "object" && driver !== null && "number" in driver && (driver.number === 2601 || driver.number === 2627)) {
      throw new RoleManagementConflict("A role with this ID already exists");
    }
    throw error;
  }

  public async save(role: Role): Promise<void> {
    await this.roleRepository.save(this.record(role));
  }

  public async insert(role: Role): Promise<void> {
    try {
      await this.roleRepository.insert(this.record(role));
    } catch (error: unknown) {
      this.writeError(error);
    }
  }

  public async replace(role: Role): Promise<void> {
    const { id, ...record }: InfraRole = this.record(role);
    const result: { affected?: number | null } = await this.roleRepository.update({ id }, record);

    if (!result.affected) {
      throw new RoleManagementNotFound("Role not found");
    }
  }

  public async deactivate(id: string): Promise<void> {
    const result: { affected?: number | null } = await this.roleRepository.update({ id }, { active: false });

    if (!result.affected) {
      throw new RoleManagementNotFound("Role not found");
    }
  }
}
