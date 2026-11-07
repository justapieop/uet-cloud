import { DeploymentAlreadyExists, DeploymentDeletionClaimLostError, DeploymentProgressConflictError, type DeploymentDeletionQueueRepository, type DeploymentListFilters, type DeploymentProgressOptions } from "@kumo/application";
import { Deployment, type DeploymentSpec, type DeploymentStatus, type DeploymentVolume } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, Index, PrimaryColumn, Repository, IsNull, type FindOptionsWhere, type SelectQueryBuilder } from "typeorm";

@Entity({ name: "deployments" })
@Index("UQ_deployments_name", ["name"], { unique: true })
@Index("IDX_deployments_pending_order", ["status", "createdAt", "id"], { where: "creation_request IS NOT NULL" })
export class InfraDeployment {
  @PrimaryColumn({ type: "nvarchar", length: 255 }) public readonly id!: string;
  @Column({ type: "nvarchar", length: 255, name: "user_id" }) public readonly userId!: string;
  @Column({ type: "nvarchar", length: 32 }) public readonly name!: string;
  @Column({ type: "nvarchar", length: 32 }) public readonly status!: DeploymentStatus;
  @Column({ type: "nvarchar", length: "MAX", name: "creation_request", nullable: true }) public readonly requestJson!: string | null;
  @Column({ type: "nvarchar", length: 1024, nullable: true }) public readonly image!: string | null;
  @Column({ type: "nvarchar", length: 36, name: "build_id", nullable: true }) public readonly buildId!: string | null;
  @Column({ type: "nvarchar", length: 2048, name: "azure_resource_id", nullable: true }) public readonly resourceId!: string | null;
  @Column({ type: "nvarchar", length: 2048, name: "azure_environment_id", nullable: true }) public readonly containerAppEnvironmentId!: string | null;
  @Column({ type: "datetime2", precision: 7, name: "container_app_deleted_at", nullable: true }) public readonly containerAppDeletedAt!: Date | null;
  @Column({ type: "uniqueidentifier", name: "deletion_claim_token", nullable: true }) public readonly deletionClaimToken!: string | null;
  @Column({ type: "uniqueidentifier", name: "active_resource_update_id", nullable: true }) public readonly activeResourceUpdateId!: string | null;
  @Column({ type: "nvarchar", length: 2048, nullable: true }) public readonly fqdn!: string | null;
  @Column({ type: "nvarchar", length: 1000, name: "error_message", nullable: true }) public readonly error!: string | null;
  @Column({ type: "datetime2", precision: 7, name: "created_at" }) public readonly createdAt!: Date;
  @Column({ type: "datetime2", precision: 7, name: "updated_at" }) public readonly updatedAt!: Date;
}

@Injectable()
export class InfraDeploymentRepository implements DeploymentDeletionQueueRepository {
  public constructor(@InjectRepository(InfraDeployment) private readonly repository: Repository<InfraDeployment>) {}

  public async findById(id: string): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.findOneBy({ id });
    return record ? this.toDomain(record) : null;
  }

  public async findByIdAndUserIdForUpdate(id: string, userId: string): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.createQueryBuilder("deployment")
      .setLock("pessimistic_write")
      .where("deployment.id = :id AND deployment.userId = :userId", { id, userId }).getOne();
    return record ? this.toDomain(record) : null;
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.findOneBy({ id, userId });
    return record ? this.toDomain(record) : null;
  }

  public async setActiveResourceUpdate(id: string, userId: string, operationId: string): Promise<boolean> {
    const rows: { readonly id: string }[] = await this.repository.manager.query<{ readonly id: string }[]>(
      "UPDATE deployments SET active_resource_update_id = @2, updated_at = SYSUTCDATETIME() OUTPUT inserted.id WHERE id = @0 AND user_id = @1 AND active_resource_update_id IS NULL AND status IN ('RUNNING', 'STOPPED')", [id, userId, operationId]);
    return rows.length === 1;
  }

  public async findByUserId(userId: string, filters: DeploymentListFilters = {}): Promise<Deployment[]> {
    const query: SelectQueryBuilder<InfraDeployment> = this.repository.createQueryBuilder("deployment")
      .where("deployment.userId = :userId", { userId });
    if (filters.status !== undefined) query.andWhere("deployment.status = :status", { status: filters.status });
    if (filters.name !== undefined) {
      query.andWhere("CHARINDEX(LOWER(:name), LOWER(deployment.name)) > 0", { name: filters.name });
    }
    if (filters.region !== undefined) {
      query.andWhere("JSON_VALUE(deployment.creation_request, '$.region') = :region", { region: filters.region });
    }
    const records: InfraDeployment[] = await query.orderBy("deployment.createdAt", "DESC").addOrderBy("deployment.id", "DESC").getMany();
    return records.map((record: InfraDeployment): Deployment => this.toDomain(record));
  }

  public async save(deployment: Deployment): Promise<void> {
    try {
      const existing: InfraDeployment | null = await this.repository.findOneBy({ id: deployment.id });
      if (!existing) {
        await this.repository.insert(this.toRecord(deployment));
        return;
      }
      // Volume changes may save creation inputs, but a stale volume operation must
      // never erase the dedicated pointer or race a newly accepted configuration.
      const record: Partial<InfraDeployment> = this.toRecord(deployment);
      const { id: ignoredId, userId: ignoredOwner, createdAt: ignoredCreatedAt, ...changes }: Partial<InfraDeployment> = record;
      const result: Awaited<ReturnType<Repository<InfraDeployment>["update"]>> = await this.repository.update({
        id: deployment.id, userId: deployment.userId, status: deployment.status, activeResourceUpdateId: IsNull(),
      }, changes);
      if (result.affected !== 1) throw new DeploymentProgressConflictError();
    } catch (error: unknown) { throw this.translateError(error); }
  }

  public async insert(deployment: Deployment): Promise<void> {
    try { await this.repository.insert(this.toRecord(deployment)); }
    catch (error: unknown) { throw this.translateError(error); }
  }

  public countReservedByUserId(userId: string): Promise<number> {
    return this.repository.createQueryBuilder("deployment").where("deployment.userId = :userId", { userId })
      .andWhere("(deployment.status IN (:...statuses) OR (deployment.status = :failed AND deployment.azure_resource_id IS NOT NULL) OR (deployment.status IN (:...deletionStatuses) AND deployment.container_app_deleted_at IS NULL))", {
        statuses: ["PENDING", "PROVISIONING", "RUNNING", "STARTING", "STOPPING"],
        failed: "FAILED",
        deletionStatuses: ["DELETE_PENDING", "DELETING", "DELETE_FAILED"],
      }).getCount();
  }

  public async update(deployment: Deployment): Promise<void> {
    try { await this.repository.update({ id: deployment.id, userId: deployment.userId, activeResourceUpdateId: IsNull() }, { name: deployment.name, updatedAt: deployment.updatedAt }); }
    catch (error: unknown) { throw this.translateError(error); }
  }

  public async updateProgress(deployment: Deployment, options: DeploymentProgressOptions = {}): Promise<void> {
    try {
      const criteria: FindOptionsWhere<InfraDeployment> = options.deletionClaimToken
        ? { id: deployment.id, userId: deployment.userId, status: "DELETING", deletionClaimToken: options.deletionClaimToken, activeResourceUpdateId: IsNull() }
        : { id: deployment.id, userId: deployment.userId, activeResourceUpdateId: IsNull(), ...(options.expectedStatus ? { status: options.expectedStatus } : {}) };
      const result: Awaited<ReturnType<Repository<InfraDeployment>["update"]>> = await this.repository.update(criteria, {
        status: deployment.status, image: deployment.image, buildId: deployment.buildId,
        resourceId: deployment.resourceId, containerAppEnvironmentId: deployment.containerAppEnvironmentId,
        containerAppDeletedAt: deployment.containerAppDeletedAt,
        fqdn: deployment.fqdn, error: deployment.error, updatedAt: deployment.updatedAt,
      });
      if (options.deletionClaimToken && result.affected !== 1) throw new DeploymentDeletionClaimLostError();
      if (result.affected !== 1) throw new DeploymentProgressConflictError();
    } catch (error: unknown) { throw this.translateError(error); }
  }

  public async transitionStatus(
    id: string,
    userId: string,
    from: DeploymentStatus,
    to: DeploymentStatus,
    options: { readonly clearError?: boolean } = {},
  ): Promise<boolean> {
    const changes: Partial<InfraDeployment> = { status: to, updatedAt: new Date() };
    if (options.clearError) Object.assign(changes, { error: null });
    if (to === "DELETE_PENDING") Object.assign(changes, { deletionClaimToken: null });
    const result: Awaited<ReturnType<Repository<InfraDeployment>["update"]>> = await this.repository.update({ id, userId, status: from, activeResourceUpdateId: IsNull() }, changes);
    return result.affected === 1;
  }

  public async delete(deploymentId: string, userId: string): Promise<void> {
    await this.repository.delete({ id: deploymentId, userId, activeResourceUpdateId: IsNull() });
  }

  public async claimNextPending(): Promise<Deployment | null> {
    const records: InfraDeployment[] = await this.repository.query(`
      ;WITH candidate AS (
        SELECT TOP (1) * FROM deployments WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
        WHERE status = 'PENDING' AND creation_request IS NOT NULL AND active_resource_update_id IS NULL ORDER BY created_at, id
      )
      UPDATE candidate SET status = 'PROVISIONING', updated_at = SYSUTCDATETIME(), error_message = NULL
      OUTPUT inserted.id, inserted.user_id AS userId, inserted.name, inserted.status,
        inserted.creation_request AS requestJson, inserted.image, inserted.build_id AS buildId,
        inserted.azure_resource_id AS resourceId, inserted.fqdn, inserted.error_message AS error,
        inserted.azure_environment_id AS containerAppEnvironmentId,
        inserted.container_app_deleted_at AS containerAppDeletedAt,
        inserted.deletion_claim_token AS deletionClaimToken,
        inserted.active_resource_update_id AS activeResourceUpdateId,
        inserted.created_at AS createdAt, inserted.updated_at AS updatedAt;
    `);
    return records[0] ? this.toDomain(records[0]) : null;
  }

  public async claimNextDeletion(): Promise<Deployment | null> {
    const records: InfraDeployment[] = await this.repository.query(`
      ;WITH candidate AS (
        SELECT TOP (1) * FROM deployments WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
        WHERE status = 'DELETE_PENDING' AND active_resource_update_id IS NULL ORDER BY updated_at, id
      )
      UPDATE candidate SET status = 'DELETING', deletion_claim_token = NEWID(), updated_at = SYSUTCDATETIME(), error_message = NULL
      OUTPUT inserted.id, inserted.user_id AS userId, inserted.name, inserted.status,
        inserted.creation_request AS requestJson, inserted.image, inserted.build_id AS buildId,
        inserted.azure_resource_id AS resourceId, inserted.fqdn, inserted.error_message AS error,
        inserted.azure_environment_id AS containerAppEnvironmentId,
        inserted.container_app_deleted_at AS containerAppDeletedAt,
        inserted.deletion_claim_token AS deletionClaimToken,
        inserted.active_resource_update_id AS activeResourceUpdateId,
        inserted.created_at AS createdAt, inserted.updated_at AS updatedAt;
    `);
    return records[0] ? this.toDomain(records[0]) : null;
  }

  public async failStaleProvisioning(before: Date): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraDeployment)
      .set({ status: "FAILED", error: "Deployment provisioning was interrupted or timed out", updatedAt: new Date() })
      .where("status = :status AND updated_at < :before AND creation_request IS NOT NULL AND active_resource_update_id IS NULL", { status: "PROVISIONING", before }).execute();
  }

  public async recoverStaleDeletions(before: Date): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraDeployment)
      .set({ status: "DELETE_PENDING", deletionClaimToken: null, error: "Deployment deletion was interrupted or timed out", updatedAt: new Date() })
      .where("status = :status AND updated_at < :before AND active_resource_update_id IS NULL", { status: "DELETING", before }).execute();
  }

  private toDomain(record: InfraDeployment): Deployment {
    let spec: DeploymentSpec | null = null;
    if (record.requestJson) {
      try {
        const parsed: DeploymentSpec = JSON.parse(record.requestJson) as DeploymentSpec;
        spec = parsed.volumes && Array.isArray(parsed.volumes)
          ? {
              ...parsed,
              volumes: parsed.volumes.map((v: DeploymentVolume): DeploymentVolume => ({
                ...v,
                sizeGb: typeof v?.sizeGb === "number" && v.sizeGb < 32 ? 32 : (v?.sizeGb ?? 32),
              })),
            }
          : parsed;
      } catch {
        spec = null;
      }
    }
    return new Deployment({
      id: record.id, userId: record.userId, name: record.name, status: record.status,
      spec,
      image: record.image, buildId: record.buildId, resourceId: record.resourceId,
      fqdn: record.fqdn, error: record.error, createdAt: record.createdAt, updatedAt: record.updatedAt,
      containerAppEnvironmentId: record.containerAppEnvironmentId,
      containerAppDeletedAt: record.containerAppDeletedAt,
      deletionClaimToken: record.deletionClaimToken,
      activeResourceUpdateId: record.activeResourceUpdateId,
    });
  }

  private toRecord(deployment: Deployment): Partial<InfraDeployment> {
    return {
      id: deployment.id, userId: deployment.userId, name: deployment.name, status: deployment.status,
      requestJson: deployment.spec ? JSON.stringify(deployment.spec) : null,
      image: deployment.image, buildId: deployment.buildId, resourceId: deployment.resourceId,
      containerAppEnvironmentId: deployment.containerAppEnvironmentId,
      containerAppDeletedAt: deployment.containerAppDeletedAt,
      deletionClaimToken: deployment.deletionClaimToken,
      fqdn: deployment.fqdn, error: deployment.error, createdAt: deployment.createdAt, updatedAt: deployment.updatedAt,
    };
  }

  private translateError(error: unknown): unknown {
    const driver: unknown = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : error;
    if (typeof driver === "object" && driver !== null && "number" in driver && (driver.number === 2601 || driver.number === 2627)) {
      return new DeploymentAlreadyExists("A deployment with this name already exists");
    }
    return error;
  }
}
