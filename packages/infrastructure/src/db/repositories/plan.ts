import type { PlanCatalogReader, PlanReader, PlanRepository } from "@kumo/application";
import { Plan } from "@kumo/domain";
import { Check, Column, Entity, Index, In, IsNull, Not, PrimaryColumn, type Repository } from "typeorm";

@Entity({ name: "plans" })
@Index("UQ_plans_stripe_product_id", ["stripeProductId"], { unique: true, where: "stripe_product_id IS NOT NULL" })
@Check("CK_plans_price", "price >= 0")
@Check("CK_plans_vcpu", "vcpu > 0")
@Check("CK_plans_memory", "memory > 0 AND memory = vcpu * 2")
@Check("CK_plans_deployments", "deployments > 0")
@Check("CK_plans_disk", "disk > 0")
@Check("CK_plans_max_replicas", "max_replicas >= 1")
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

  @Column({ name: "stripe_product_id", type: "varchar", length: 255, nullable: true, collation: "Latin1_General_100_BIN2" })
  public readonly stripeProductId!: string | null;

  @Column({ name: "max_replicas", type: "int", default: 1 })
  public readonly maxReplicas!: number;
}

export class InfraPlanRepository implements PlanRepository, PlanReader, PlanCatalogReader {
  public constructor(private readonly repository: Repository<InfraPlan>) {}

  public async findAvailable(): Promise<Plan[]> {
    const records: InfraPlan[] = await this.repository.find({
      where: { active: true, stripeProductId: Not(IsNull()) },
      order: { price: "ASC", id: "ASC" },
    });
    return records.map((record: InfraPlan): Plan => new Plan({ ...record }));
  }

  public async findById(id: string): Promise<Plan | null> {
    const record: InfraPlan | null = await this.repository.findOneBy({ id });
    return record ? new Plan({ ...record }) : null;
  }

  public async findActiveByStripeProductIds(productIds: readonly string[]): Promise<Plan[]> {
    if (productIds.length === 0) return [];
    const records: InfraPlan[] = await this.repository.findBy({ active: true, stripeProductId: In([...productIds]) });
    return records.map((record: InfraPlan): Plan => new Plan({ ...record }));
  }
}
