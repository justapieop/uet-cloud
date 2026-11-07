import type { ScaleRuleRepository } from "@kumo/application";
import { ScaleRule, type ScaleRuleDetails } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, Index, PrimaryColumn, Repository } from "typeorm";

@Entity({ name: "scale_rules" })
@Index("IDX_scale_rules_due", ["enabled", "nextEvaluationAt", "deploymentId"])
export class InfraScaleRule implements ScaleRuleDetails {
  @PrimaryColumn({ name: "deployment_id", type: "nvarchar", length: 255 }) public readonly deploymentId!: string;
  @Column({ type: "bit" }) public readonly enabled!: boolean;
  @Column({ type: "nvarchar", length: 16 }) public readonly metric!: "cpu";
  @Column({ name: "scale_out_threshold", type: "float" }) public readonly scaleOutThreshold!: number;
  @Column({ name: "scale_in_threshold", type: "float" }) public readonly scaleInThreshold!: number;
  @Column({ name: "min_replicas", type: "int" }) public readonly minReplicas!: number;
  @Column({ name: "max_replicas", type: "int" }) public readonly maxReplicas!: number;
  @Column({ name: "evaluation_window_seconds", type: "int" }) public readonly evaluationWindowSeconds!: number;
  @Column({ name: "cooldown_seconds", type: "int" }) public readonly cooldownSeconds!: number;
  @Column({ name: "created_at", type: "datetime2", precision: 7 }) public readonly createdAt!: Date;
  @Column({ name: "updated_at", type: "datetime2", precision: 7 }) public readonly updatedAt!: Date;
  @Column({ name: "last_evaluated_at", type: "datetime2", precision: 7, nullable: true }) public readonly lastEvaluatedAt!: Date | null;
  @Column({ name: "last_scaled_at", type: "datetime2", precision: 7, nullable: true }) public readonly lastScaledAt!: Date | null;
  @Column({ name: "last_action", type: "nvarchar", length: 16 }) public readonly lastAction!: ScaleRuleDetails["lastAction"];
  @Column({ name: "last_reason", type: "nvarchar", length: 255 }) public readonly lastReason!: string;
  @Column({ name: "next_evaluation_at", type: "datetime2", precision: 7, default: (): string => "SYSUTCDATETIME()" }) public readonly nextEvaluationAt!: Date;
}

@Injectable()
export class InfraScaleRuleRepository implements ScaleRuleRepository {
  public constructor(@InjectRepository(InfraScaleRule) private readonly repository: Repository<InfraScaleRule>) {}

  public async findByDeploymentId(deploymentId: string): Promise<ScaleRule | null> {
    const row: InfraScaleRule | null = await this.repository.findOneBy({ deploymentId });
    if (!row) return null;
    // Keep the polling checkpoint internal to infrastructure.
    const { nextEvaluationAt: checkpoint, ...details }: InfraScaleRule = row;
    void checkpoint;
    return new ScaleRule(details);
  }

  public async save(rule: ScaleRule): Promise<void> { await this.repository.save(rule.getDetails()); }
  public async delete(deploymentId: string): Promise<void> { await this.repository.delete({ deploymentId }); }

  public async claimNextDue(): Promise<string | null> {
    const rows: { readonly deploymentId: string }[] = await this.repository.query(`
      ;WITH candidate AS (
        SELECT TOP (1) * FROM scale_rules WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
        WHERE enabled = 1 AND next_evaluation_at <= SYSUTCDATETIME()
          AND EXISTS (SELECT 1 FROM deployments d WHERE d.id = scale_rules.deployment_id AND d.status = 'RUNNING')
        ORDER BY next_evaluation_at, deployment_id
      )
      UPDATE candidate SET next_evaluation_at = DATEADD(SECOND, 60, SYSUTCDATETIME())
      OUTPUT inserted.deployment_id AS deploymentId;
    `);
    return rows[0]?.deploymentId ?? null;
  }
}
