import { SubscriptionNotFound, type SubscriptionListFilters, type SubscriptionRepository } from "@kumo/application";
import { Subscription } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Repository, type FindOptionsWhere, type UpdateResult } from "typeorm";
import { InfraPlan } from "./plan.js";
import { InfraUser } from "./user.js";

@Entity({ name: "subscriptions" })
@Index("IDX_subscriptions_user_active", ["userId", "active"])
@Index("IDX_subscriptions_plan_id", ["planId"])
export class InfraSubscription {
  @PrimaryColumn({ type: "nvarchar", length: 255 })
  public readonly id!: string;

  @Column({ type: "nvarchar", length: 255, name: "user_id" })
  public readonly userId!: string;

  @Column({ type: "nvarchar", length: 255, name: "plan_id" })
  public readonly planId!: string;

  @Column({ type: "bit", default: false })
  public readonly active!: boolean;

  @Column({ type: "datetime2", precision: 7, name: "created_at", default: (): string => "SYSUTCDATETIME()" })
  public readonly createdAt!: Date;

  @ManyToOne(() => InfraUser, { nullable: false, onDelete: "NO ACTION", onUpdate: "NO ACTION" })
  @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_subscriptions_user" })
  public readonly user?: InfraUser;

  @ManyToOne(() => InfraPlan, { nullable: false, onDelete: "NO ACTION", onUpdate: "NO ACTION" })
  @JoinColumn({ name: "plan_id", foreignKeyConstraintName: "FK_subscriptions_plan" })
  public readonly plan?: InfraPlan;
}

@Injectable()
export class InfraSubscriptionRepository implements SubscriptionRepository {
  public constructor(@InjectRepository(InfraSubscription) private readonly repository: Repository<InfraSubscription>) {}

  public async findById(id: string): Promise<Subscription | null> {
    const record: InfraSubscription | null = await this.repository.findOneBy({ id });
    return record ? this.toDomain(record) : null;
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Subscription | null> {
    const record: InfraSubscription | null = await this.repository.findOneBy({ id, userId });
    return record ? this.toDomain(record) : null;
  }

  public async findByUserId(userId: string, filters: SubscriptionListFilters = {}): Promise<Subscription[]> {
    const where: FindOptionsWhere<InfraSubscription> = {
      userId,
      ...(filters.active !== undefined ? { active: filters.active } : {}),
      ...(filters.planId !== undefined ? { planId: filters.planId } : {}),
    };
    const records: InfraSubscription[] = await this.repository.find({ where, order: { createdAt: "DESC", id: "DESC" } });
    return records.map((record: InfraSubscription): Subscription => this.toDomain(record));
  }

  public async save(subscription: Subscription): Promise<void> {
    // Insert is intentional: saving an existing ID must not overwrite its owner or plan.
    await this.repository.insert({
      id: subscription.id, userId: subscription.userId, planId: subscription.planId,
      active: subscription.active, createdAt: subscription.createdAt,
    });
  }

  public async update(subscription: Subscription): Promise<void> {
    const result: UpdateResult = await this.repository.update(
      { id: subscription.id, userId: subscription.userId },
      { planId: subscription.planId, active: subscription.active },
    );
    if (result.affected !== 1) throw new SubscriptionNotFound("Subscription was not found for this user");
  }

  private toDomain(record: InfraSubscription): Subscription {
    return new Subscription({
      id: record.id, userId: record.userId, planId: record.planId,
      active: record.active, createdAt: record.createdAt,
    });
  }
}
