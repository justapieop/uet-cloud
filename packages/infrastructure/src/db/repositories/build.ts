import { Build, type BuildDetails, type BuildStatus } from "@kumo/domain";
import type { BuildQueueRepository } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, PrimaryColumn, Repository, type UpdateResult } from "typeorm";

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

  public async claimNextPending(): Promise<Build | null> {
    const record: InfraBuild | null = await this.repository.createQueryBuilder("build")
      .where("build.status = :status", { status: "PENDING" })
      .orderBy("build.createdAt", "ASC").addOrderBy("build.id", "ASC").getOne();
    if (!record) return null;
    const result: UpdateResult = await this.repository.createQueryBuilder().update(InfraBuild)
      .set({ status: "PREPARING", updatedAt: new Date() })
      .where("id = :id AND status = :status", { id: record.id, status: "PENDING" }).execute();
    // Only the worker that won the conditional update may schedule this build.
    return result.affected === 1 ? this.findById(record.id) : null;
  }

  public async failStalePreparations(before: Date): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraBuild)
      .set({ status: "FAILED", error: "Build preparation was interrupted or timed out; submit a new build", updatedAt: new Date() })
      .where("status = :status AND updated_at < :before", { status: "PREPARING", before }).execute();
  }
}
