import { Build, type BuildDetails, type BuildStatus } from "@kumo/domain";
import type { BuildQueueRepository, PipelineRun } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, PrimaryColumn, Repository } from "typeorm";

@Entity({ name: "builds" })
export class InfraBuild implements BuildDetails {
  @PrimaryColumn({ type: "nvarchar", length: 36 }) public readonly id!: string;
  @Column({ type: "nvarchar", length: 255, name: "user_id" }) public readonly userId!: string;
  @Column({ type: "nvarchar", length: 2048 }) public readonly repo!: string;
  @Column({ type: "nvarchar", length: 40, name: "commit_sha", nullable: true }) public readonly commitSha!: string | null;
  @Column({ type: "nvarchar", length: 255, nullable: true }) public readonly ref!: string | null;
  @Column({ type: "nvarchar", length: 2048, nullable: true }) public readonly error!: string | null;
  @Column({ type: "nvarchar", length: 1024, name: "dockerfile_path" }) public readonly dockerFilePath!: string;
  @Column({ type: "nvarchar", length: 1024 }) public readonly image!: string;
  @Column({ type: "nvarchar", length: 32 }) public readonly status!: BuildStatus;
  @Column({ type: "nvarchar", length: 64, name: "source_token_hash", select: false }) public readonly sourceTokenHash!: string;
  @Column({ type: "datetime2", name: "source_expires_at" }) public readonly sourceExpiresAt!: Date;
  @Column({ type: "nvarchar", length: 32, name: "run_id", nullable: true }) public readonly runId!: string | null;
  @Column({ type: "nvarchar", length: 2048, name: "run_url", nullable: true }) public readonly runUrl!: string | null;
  @Column({ type: "datetime2", name: "created_at" }) public readonly createdAt!: Date;
  @Column({ type: "datetime2", name: "updated_at" }) public readonly updatedAt!: Date;
}

@Injectable()
export class InfraBuildRepository implements BuildQueueRepository {
  public constructor(@InjectRepository(InfraBuild) private readonly repository: Repository<InfraBuild>) {}
  public async findById(id: string): Promise<Build | null> {
    const record: InfraBuild | null = await this.repository.createQueryBuilder("build")
      .addSelect("build.sourceTokenHash").where("build.id = :id", { id }).getOne();
    return record ? new Build(record) : null;
  }
  public async save(build: Build): Promise<void> {
    await this.repository.save(this.repository.create(build.getDetails()));
  }

  public async insert(build: Build): Promise<void> { await this.repository.insert(build.getDetails()); }

  public async update(build: Build): Promise<void> {
    const details: BuildDetails = build.getDetails();
    await this.repository.update({ id: details.id, userId: details.userId }, {
      commitSha: details.commitSha, image: details.image, sourceTokenHash: details.sourceTokenHash, sourceExpiresAt: details.sourceExpiresAt,
      status: details.status, error: details.error, runId: details.runId, runUrl: details.runUrl, updatedAt: details.updatedAt,
    });
  }

  public async updateRun(id: string, userId: string, expectedStatus: BuildStatus, run: PipelineRun): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraBuild)
      .set({ status: run.status, runId: run.runId, runUrl: run.runUrl, updatedAt: new Date() })
      .where("id = :id AND user_id = :userId AND status = :expectedStatus AND run_id = :runId", { id, userId, expectedStatus, runId: run.runId })
      .andWhere("status NOT IN (:...terminal)", { terminal: ["SUCCEEDED", "FAILED", "CANCELED"] }).execute();
  }

  public async claimNextPending(): Promise<Build | null> {
    const records: InfraBuild[] = await this.repository.query(`
      ;WITH candidate AS (
        SELECT TOP (1) * FROM builds WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
        WHERE status = 'PENDING' ORDER BY created_at, id
      )
      UPDATE candidate SET status = 'PREPARING', updated_at = SYSUTCDATETIME()
      OUTPUT inserted.id, inserted.user_id AS userId, inserted.repo, inserted.ref, inserted.error,
        inserted.commit_sha AS commitSha, inserted.dockerfile_path AS dockerFilePath, inserted.image, inserted.status,
        inserted.source_token_hash AS sourceTokenHash, inserted.source_expires_at AS sourceExpiresAt,
        inserted.run_id AS runId, inserted.run_url AS runUrl, inserted.created_at AS createdAt, inserted.updated_at AS updatedAt;
    `);
    return records[0] ? new Build(records[0]) : null;
  }

  public async failStalePreparations(before: Date): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraBuild)
      .set({ status: "FAILED", error: "Build preparation was interrupted or timed out; submit a new build", updatedAt: new Date() })
      .where("status = :status AND updated_at < :before", { status: "PREPARING", before }).execute();
  }
}
