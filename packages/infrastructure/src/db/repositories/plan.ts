import { AdminBillingConflict, AdminBillingNotFound, type AdminPlanRepository, type PlanCatalogReader, type PlanReader, type PlanRepository } from "@kumo/application";
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

export class InfraPlanRepository implements PlanRepository, PlanReader, PlanCatalogReader, AdminPlanRepository {
  public constructor(private readonly repository: Repository<InfraPlan>) {}

  public async list(page: number, perPage: number): Promise<Plan[]> {
    const records: InfraPlan[] = await this.repository.find({ order: { id: "ASC" }, skip: (page - 1) * perPage, take: perPage + 1 });
    return records.map((record: InfraPlan): Plan => new Plan({ ...record }));
  }

  private record(plan: Plan): InfraPlan {
    return { id: plan.id, name: plan.name, price: plan.price, vcpu: plan.vcpu, memory: plan.memory, deployments: plan.deployments,
      disk: plan.disk, active: plan.active, stripeProductId: plan.stripeProductId, maxReplicas: plan.maxReplicas };
  }

  private writeError(error: unknown): never {
    const driver: unknown = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : error;
    if (typeof driver === "object" && driver !== null && "number" in driver && (driver.number === 2601 || driver.number === 2627)) {
      throw new AdminBillingConflict("Plan ID or Stripe product mapping already exists");
    }
    throw error;
  }

  public async insert(plan: Plan): Promise<void> {
    try { await this.repository.insert(this.record(plan)); } catch (error: unknown) { this.writeError(error); }
  }

  public async replace(plan: Plan): Promise<void> {
    const { id, ...record }: InfraPlan = this.record(plan);
    try {
      const result: { affected?: number | null } = await this.repository.update({ id }, record);
      if (!result.affected) throw new AdminBillingNotFound("Plan not found");
    } catch (error: unknown) { this.writeError(error); }
  }

  public async deactivate(id: string): Promise<void> {
    const result: { affected?: number | null } = await this.repository.update({ id }, { active: false });
    if (!result.affected) throw new AdminBillingNotFound("Plan not found");
  }

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
