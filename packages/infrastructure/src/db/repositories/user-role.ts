import type { UserRoleRepository } from "@kumo/application";
import { Role } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation, Repository } from "typeorm";
import { InfraUser } from "./user.js";
import { InfraRole } from "./role.js";

@Entity({ name: "user_roles" })
@Index("UQ_user_roles_user_role", ["userId", "roleId"], { unique: true })
@Index("IDX_user_roles_role_id", ["roleId"])
export class InfraUserRole {
  @PrimaryGeneratedColumn("uuid")
  public readonly id!: string;

  @Column({ name: "user_id", type: "nvarchar", length: 255 })
  public readonly userId!: string;

  @Column({ name: "role_id", type: "nvarchar", length: 255 })
  public readonly roleId!: string;

  @ManyToOne(() => InfraUser, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_user_roles_user_id" })
  public readonly user?: Relation<InfraUser>;

  @ManyToOne(() => InfraRole, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "role_id", foreignKeyConstraintName: "FK_user_roles_role_id" })
  public readonly role?: Relation<InfraRole>;
}

@Injectable()
export class InfraUserRoleRepository implements UserRoleRepository {
  public constructor(
    @InjectRepository(InfraUserRole)
    private readonly assignmentRepository: Repository<InfraUserRole>,
  ) { }

  public async findByUserId(userId: string): Promise<Role[]> {
    const assignments: InfraUserRole[] = await this.assignmentRepository.find({
      where: { userId },
      relations: { role: true },
      order: { roleId: "ASC" },
    });

    return assignments.flatMap((assignment: InfraUserRole): Role[] => {
      const role: InfraRole | undefined = assignment.role;

      return role
        ? [new Role({
            id: role.id,
            name: role.name,
            permission: role.permission,
            createdAt: role.createdAt,
            active: role.active,
          })]
        : [];
    });
  }

  public async replaceForUser(userId: string, roleIds: readonly string[]): Promise<void> {
    await this.assignmentRepository.delete({ userId });

    if (roleIds.length === 0) {
      return;
    }

    await this.assignmentRepository.insert(
      roleIds.map((roleId: string): Partial<InfraUserRole> => ({ userId, roleId })),
    );
  }
}
