import { Check, Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "plans" })
@Check("CK_plans_price", "price >= 0")
@Check("CK_plans_vcpu", "vcpu > 0")
@Check("CK_plans_memory", "memory > 0 AND memory = vcpu * 2")
@Check("CK_plans_deployments", "deployments > 0")
@Check("CK_plans_disk", "disk > 0")
export class InfraPlan {
  @PrimaryColumn({ type: "nvarchar", length: 255 })
  public readonly id!: string;

  @Column({ type: "nvarchar", length: 255 })
  public readonly name!: string;

  @Column({
    type: "decimal", precision: 19, scale: 4,
    transformer: {
      to(value: number): number { return value; },
      from(value: string | number): number { return Number(value); },
    },
  })
  public readonly price!: number;

  @Column({ type: "float" })
  public readonly vcpu!: number;

  @Column({ type: "float" })
  public readonly memory!: number;

  @Column({ type: "int" })
  public readonly deployments!: number;

  @Column({ type: "int" })
  public readonly disk!: number;

  @Column({ type: "bit", default: true })
  public readonly active!: boolean;
}
