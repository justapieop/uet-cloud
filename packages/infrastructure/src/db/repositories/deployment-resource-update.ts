import type {
  DeploymentResourceUpdateQueueRepository,
  DeploymentResourceUpdateProgress,
} from "@kumo/application";
import {
  DeploymentResourceUpdate,
  type DeploymentResourceUpdateDetails,
  type DeploymentResourceUpdateStatus,
} from "@kumo/domain";
import { Column, Entity, Index, PrimaryColumn, type EntityManager } from "typeorm";

@Entity({ name: "deployment_resource_updates" })
@Index("UQ_deployment_resource_updates_key_hash", ["keyHash"], { unique: true })
@Index("UQ_deployment_resource_updates_active", ["deploymentId"], { unique: true, where: "completed_at IS NULL" })
@Index("IDX_deployment_resource_updates_queue", ["status", "nextAttemptAt", "createdAt"])
@Index("IDX_deployment_resource_updates_history", ["deploymentId", "createdAt"])
export class InfraDeploymentResourceUpdate {
  @PrimaryColumn({ type: "uniqueidentifier" }) public readonly id!: string;
  @Column({ name: "deployment_id", type: "nvarchar", length: 255 }) public readonly deploymentId!: string;
  @Column({ name: "user_id", type: "nvarchar", length: 255 }) public readonly userId!: string;
  @Column({ name: "key_hash", type: "varchar", length: 64 }) public readonly keyHash!: string;
  @Column({ type: "varchar", length: 64 }) public readonly fingerprint!: string;
  @Column({ name: "requested_json", type: "nvarchar", length: "MAX" }) public readonly requestedJson!: string;
  @Column({ name: "baseline_json", type: "nvarchar", length: "MAX" }) public readonly baselineJson!: string;
  @Column({ name: "receipt_json", type: "nvarchar", length: "MAX" }) public readonly receiptJson!: string;
  @Column({ type: "nvarchar", length: 16 }) public readonly lifecycle!: "RUNNING" | "STOPPED";
  @Column({ name: "billing_customer_id", type: "varchar", length: 255 }) public readonly billingCustomerId!: string;
  @Column({ type: "nvarchar", length: 16 }) public readonly status!: DeploymentResourceUpdateStatus;
  @Column({ name: "claim_token", type: "uniqueidentifier", nullable: true }) public readonly claimToken!: string | null;
  @Column({ name: "claim_expires_at", type: "datetime2", precision: 7, nullable: true }) public readonly claimExpiresAt!: Date | null;
  @Column({ name: "heartbeat_at", type: "datetime2", precision: 7, nullable: true }) public readonly heartbeatAt!: Date | null;
  @Column({ name: "next_attempt_at", type: "datetime2", precision: 7 }) public readonly nextAttemptAt!: Date;
  @Column({ name: "target_revision", type: "nvarchar", length: 128, nullable: true }) public readonly targetRevision!: string | null;
  @Column({ name: "observed_json", type: "nvarchar", length: "MAX", nullable: true }) public readonly observedJson!: string | null;
  @Column({ name: "no_op", type: "bit", nullable: true }) public readonly noOp!: boolean | null;
  @Column({ name: "error_code", type: "varchar", length: 64, nullable: true }) public readonly errorCode!: string | null;
  @Column({ name: "error_message", type: "nvarchar", length: 1000, nullable: true }) public readonly errorMessage!: string | null;
  @Column({ name: "created_at", type: "datetime2", precision: 7 }) public readonly createdAt!: Date;
  @Column({ name: "started_at", type: "datetime2", precision: 7, nullable: true }) public readonly startedAt!: Date | null;
  @Column({ name: "completed_at", type: "datetime2", precision: 7, nullable: true }) public readonly completedAt!: Date | null;
}

/** All SQL operations use this manager; UoW instances never open a nested transaction. */
export class InfraDeploymentResourceUpdateRepository implements DeploymentResourceUpdateQueueRepository {
  public constructor(private readonly manager: EntityManager, public readonly claimDurationMs: number = 120_000) {
    if (!Number.isInteger(claimDurationMs) || claimDurationMs < 3_000 || claimDurationMs > 2_147_483_647) {
      throw new Error("Resource-update claim duration must be an integer from 3000 to 2147483647 milliseconds");
    }
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<DeploymentResourceUpdate | null> {
    const rows: InfraDeploymentResourceUpdate[] = await this.manager.getRepository(InfraDeploymentResourceUpdate).findBy({ id, userId });
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  public async findByKeyHash(keyHash: string): Promise<DeploymentResourceUpdate | null> {
    const row: InfraDeploymentResourceUpdate | null = await this.manager.getRepository(InfraDeploymentResourceUpdate).findOneBy({ keyHash });
    return row ? this.toDomain(row) : null;
  }

  public async findLatestByDeploymentId(deploymentId: string, userId: string): Promise<DeploymentResourceUpdate | null> {
    const row: InfraDeploymentResourceUpdate | null = await this.manager.getRepository(InfraDeploymentResourceUpdate).findOne({
      where: { deploymentId, userId }, order: { createdAt: "DESC", id: "DESC" },
    });
    return row ? this.toDomain(row) : null;
  }

  public findLatestByDeployment(deploymentId: string, userId: string): Promise<DeploymentResourceUpdate | null> {
    return this.findLatestByDeploymentId(deploymentId, userId);
  }

  public async insert(update: DeploymentResourceUpdate): Promise<void> {
    const details: DeploymentResourceUpdateDetails = update.getDetails();
    await this.manager.query(`
      INSERT INTO deployment_resource_updates
        (id, deployment_id, user_id, key_hash, fingerprint, requested_json, baseline_json, receipt_json,
         lifecycle, billing_customer_id, status, claim_token, claim_expires_at, heartbeat_at, target_revision,
         observed_json, no_op, error_code, error_message, created_at, started_at, completed_at, next_attempt_at)
      VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, @9, 'PENDING', NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, SYSUTCDATETIME(), NULL, NULL, SYSUTCDATETIME())`, [
      details.id, details.deploymentId, details.userId, details.keyHash, details.fingerprint,
      JSON.stringify(details.requested), JSON.stringify(details.baseline), JSON.stringify(details.receipt),
      details.lifecycle, details.billingCustomerId,
    ]);
  }

  public async claimNext(): Promise<DeploymentResourceUpdate | null> {
    const work: (manager: EntityManager) => Promise<DeploymentResourceUpdate | null> = async (manager: EntityManager): Promise<DeploymentResourceUpdate | null> => {
      // This preliminary read does not retain a command lock. All paths that need
      // both records lock the deployment first, then arbitrate on the command.
      const candidates: { readonly id: string; readonly deploymentId: string; readonly userId: string }[] = await manager.query<{ readonly id: string; readonly deploymentId: string; readonly userId: string }[]>(`
        SELECT TOP (1) id, deployment_id AS deploymentId, user_id AS userId
        FROM deployment_resource_updates WITH (READPAST, READCOMMITTEDLOCK)
        WHERE status IN ('PENDING', 'RECONCILING') AND completed_at IS NULL
          AND claim_token IS NULL AND next_attempt_at <= SYSUTCDATETIME()
        ORDER BY next_attempt_at, created_at, id`);
      const candidate: { readonly id: string; readonly deploymentId: string; readonly userId: string } | undefined = candidates[0];
      if (!candidate) return null;
      const parents: { readonly id: string }[] = await manager.query<{ readonly id: string }[]>(`
        SELECT id FROM deployments WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
        WHERE id = @0 AND user_id = @1 AND active_resource_update_id = @2`,
        [candidate.deploymentId, candidate.userId, candidate.id]);
      if (parents.length !== 1) return null;
      const rows: InfraDeploymentResourceUpdate[] = await manager.query<InfraDeploymentResourceUpdate[]>(`
        UPDATE deployment_resource_updates SET status = CASE WHEN status = 'PENDING' THEN 'APPLYING' ELSE status END,
          claim_token = NEWID(), heartbeat_at = SYSUTCDATETIME(),
          claim_expires_at = DATEADD(MILLISECOND, @3, SYSUTCDATETIME()),
          started_at = COALESCE(started_at, SYSUTCDATETIME())
        OUTPUT inserted.* WHERE id = @0 AND user_id = @1 AND deployment_id = @2
          AND status IN ('PENDING', 'RECONCILING') AND completed_at IS NULL
          AND claim_token IS NULL AND next_attempt_at <= SYSUTCDATETIME()`,
        [candidate.id, candidate.userId, candidate.deploymentId, this.claimDurationMs]);
      return rows[0] ? this.toDomain(this.fromSqlRow(rows[0])) : null;
    };
    return this.manager.queryRunner?.isTransactionActive ? work(this.manager) : this.manager.transaction(work);
  }

  public async heartbeat(id: string, userId: string, claimToken: string): Promise<boolean> {
    const rows: { readonly id: string }[] = await this.manager.query<{ readonly id: string }[]>(`
      UPDATE deployment_resource_updates SET heartbeat_at = SYSUTCDATETIME(),
        claim_expires_at = DATEADD(MILLISECOND, @3, SYSUTCDATETIME())
      OUTPUT inserted.id WHERE id = @0 AND user_id = @1 AND claim_token = @2
        AND claim_expires_at > SYSUTCDATETIME() AND status IN ('APPLYING', 'RECONCILING')
        AND completed_at IS NULL`, [id, userId, claimToken, this.claimDurationMs]);
    return rows.length === 1;
  }

  public async updateClaimed(input: DeploymentResourceUpdateProgress): Promise<boolean> {
    const work: (manager: EntityManager) => Promise<boolean> = async (manager: EntityManager): Promise<boolean> => {
      const terminal: boolean = input.status === "SUCCEEDED" || input.status === "FAILED";
      const release: boolean = terminal || input.releaseClaim === true;
      const assignments: string[] = ["status = @4"];
      const parameters: unknown[] = [input.operationId, input.userId, input.claimToken, input.expectedStatus, input.status];
      const assign: (column: string, value: unknown) => void = (column: string, value: unknown): void => {
        assignments.push(`${column} = @${parameters.length}`);
        parameters.push(value);
      };
      if (input.targetRevision !== undefined) assign("target_revision", input.targetRevision);
      if (input.observed !== undefined) assign("observed_json", input.observed === null ? null : JSON.stringify(input.observed));
      if (input.noOp !== undefined) assign("no_op", input.noOp);
      if (input.errorCode !== undefined) assign("error_code", input.errorCode);
      if (input.errorMessage !== undefined) assign("error_message", input.errorMessage);
      if (terminal) assignments.push("completed_at = SYSUTCDATETIME()");
      if (release) assignments.push("claim_token = NULL", "claim_expires_at = NULL");
      if (input.retryAfterMs !== undefined) {
        const delay: number = Math.max(1000, Math.min(2_147_483_647, Math.floor(input.retryAfterMs)));
        assignments.push(`next_attempt_at = DATEADD(MILLISECOND, @${parameters.length}, SYSUTCDATETIME())`);
        parameters.push(delay);
      }
      // Match admission's lock order: deployment row before command row. The first read
      // only obtains the immutable parent ID and releases its read lock at statement end.
      const parents: { readonly deploymentId: string }[] = await manager.query<{ readonly deploymentId: string }[]>(
        "SELECT deployment_id AS deploymentId FROM deployment_resource_updates WHERE id = @0 AND user_id = @1", [input.operationId, input.userId]);
      if (!parents[0]) return false;
      const locked: { readonly id: string }[] = await manager.query<{ readonly id: string }[]>(
        "SELECT id FROM deployments WITH (UPDLOCK, HOLDLOCK) WHERE id = @0 AND user_id = @1 AND active_resource_update_id = @2",
        [parents[0].deploymentId, input.userId, input.operationId]);
      if (locked.length !== 1) return false;
      const rows: { readonly deploymentId: string }[] = await manager.query<{ readonly deploymentId: string }[]>(`
        UPDATE deployment_resource_updates SET ${assignments.join(", ")}
        OUTPUT inserted.deployment_id AS deploymentId
        WHERE id = @0 AND user_id = @1 AND claim_token = @2 AND status = @3
          AND completed_at IS NULL AND claim_expires_at > SYSUTCDATETIME()
          AND EXISTS (SELECT 1 FROM deployments WHERE deployments.id = deployment_resource_updates.deployment_id
            AND deployments.user_id = @1 AND deployments.active_resource_update_id = @0)`, parameters);
      if (rows.length !== 1) return false;
      if (terminal) await manager.query(
        "UPDATE deployments SET active_resource_update_id = NULL, updated_at = SYSUTCDATETIME() WHERE id = @0 AND user_id = @1 AND active_resource_update_id = @2",
        [rows[0]!.deploymentId, input.userId, input.operationId]);
      return true;
    };
    return this.manager.queryRunner?.isTransactionActive ? work(this.manager) : this.manager.transaction(work);
  }

  public async recoverStaleClaims(): Promise<number> {
    const recovery: { readonly count: number; readonly userIds: readonly string[] } = await this.recoverStaleClaimsWithOwners();
    return recovery.count;
  }

  public async recoverStaleClaimsWithOwners(): Promise<{ readonly count: number; readonly userIds: readonly string[] }> {
    const rows: { readonly id: string; readonly userId: string }[] = await this.manager.query<{ readonly id: string; readonly userId: string }[]>(`
      UPDATE deployment_resource_updates SET status = 'RECONCILING', claim_token = NULL, claim_expires_at = NULL,
        next_attempt_at = SYSUTCDATETIME(), error_code = 'RESOURCE_UPDATE_OUTCOME_UNKNOWN',
        error_message = 'The previous worker lost its claim; Azure reconciliation is required'
      OUTPUT inserted.id, inserted.user_id AS userId WHERE status IN ('APPLYING', 'RECONCILING') AND completed_at IS NULL
        AND claim_token IS NOT NULL AND claim_expires_at <= SYSUTCDATETIME()`);
    return { count: rows.length, userIds: [...new Set<string>(rows.map((row: { readonly userId: string }): string => row.userId))] };
  }

  private toDomain(row: InfraDeploymentResourceUpdate): DeploymentResourceUpdate {
    return new DeploymentResourceUpdate({
      id: row.id, deploymentId: row.deploymentId, userId: row.userId, keyHash: row.keyHash, fingerprint: row.fingerprint,
      requested: JSON.parse(row.requestedJson) as DeploymentResourceUpdateDetails["requested"],
      baseline: JSON.parse(row.baselineJson) as DeploymentResourceUpdateDetails["baseline"],
      receipt: JSON.parse(row.receiptJson) as DeploymentResourceUpdateDetails["receipt"],
      lifecycle: row.lifecycle, billingCustomerId: row.billingCustomerId, status: row.status,
      claimToken: row.claimToken, claimExpiresAt: row.claimExpiresAt, heartbeatAt: row.heartbeatAt,
      targetRevision: row.targetRevision,
      observed: row.observedJson === null ? null : JSON.parse(row.observedJson) as DeploymentResourceUpdateDetails["observed"],
      noOp: row.noOp, errorCode: row.errorCode, errorMessage: row.errorMessage,
      createdAt: row.createdAt, startedAt: row.startedAt, completedAt: row.completedAt,
    });
  }

  /** UPDATE OUTPUT returns physical names rather than TypeORM entity property names. */
  private fromSqlRow(row: InfraDeploymentResourceUpdate): InfraDeploymentResourceUpdate {
    const raw: Readonly<Record<string, unknown>> = row as unknown as Readonly<Record<string, unknown>>;
    return {
      id: raw.id as string, deploymentId: raw.deployment_id as string, userId: raw.user_id as string,
      keyHash: raw.key_hash as string, fingerprint: raw.fingerprint as string,
      requestedJson: raw.requested_json as string, baselineJson: raw.baseline_json as string, receiptJson: raw.receipt_json as string,
      lifecycle: raw.lifecycle as "RUNNING" | "STOPPED", billingCustomerId: raw.billing_customer_id as string,
      status: raw.status as DeploymentResourceUpdateStatus,
      claimToken: raw.claim_token as string | null, claimExpiresAt: raw.claim_expires_at as Date | null,
      heartbeatAt: raw.heartbeat_at as Date | null, nextAttemptAt: raw.next_attempt_at as Date,
      targetRevision: raw.target_revision as string | null, observedJson: raw.observed_json as string | null,
      noOp: raw.no_op as boolean | null, errorCode: raw.error_code as string | null, errorMessage: raw.error_message as string | null,
      createdAt: raw.created_at as Date, startedAt: raw.started_at as Date | null, completedAt: raw.completed_at as Date | null,
    };
  }
}
