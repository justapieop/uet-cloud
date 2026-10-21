import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from "typeorm";
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
