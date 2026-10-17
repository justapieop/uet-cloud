import { DeploymentAlreadyExists, type DeploymentListFilters, type DeploymentQueueRepository } from "@kumo/application";
import { Deployment, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, Entity, PrimaryColumn, Repository, type SelectQueryBuilder, type UpdateResult } from "typeorm";

@Entity({ name: "deployments" })
export class InfraDeployment {
  @PrimaryColumn({ type: "nvarchar", length: 255 }) public readonly id!: string;
  @Column({ type: "nvarchar", length: 255, name: "user_id" }) public readonly userId!: string;
  @Column({ type: "nvarchar", length: 32 }) public readonly name!: string;
  @Column({ type: "nvarchar", length: 32 }) public readonly status!: DeploymentStatus;
  @Column({ type: "nvarchar", length: "MAX", name: "creation_request", nullable: true }) public readonly requestJson!: string | null;
  @Column({ type: "nvarchar", length: 1024, nullable: true }) public readonly image!: string | null;
  @Column({ type: "nvarchar", length: 36, name: "build_id", nullable: true }) public readonly buildId!: string | null;
  @Column({ type: "nvarchar", length: 2048, name: "azure_resource_id", nullable: true }) public readonly resourceId!: string | null;
  @Column({ type: "nvarchar", length: 2048, nullable: true }) public readonly fqdn!: string | null;
  @Column({ type: "nvarchar", length: 1000, name: "error_message", nullable: true }) public readonly error!: string | null;
  @Column({ type: "datetime2", precision: 7, name: "created_at" }) public readonly createdAt!: Date;
  @Column({ type: "datetime2", precision: 7, name: "updated_at" }) public readonly updatedAt!: Date;
}

@Injectable()
export class InfraDeploymentRepository implements DeploymentQueueRepository {
  public constructor(@InjectRepository(InfraDeployment) private readonly repository: Repository<InfraDeployment>) {}

  public async findById(id: string): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.findOneBy({ id });
    return record ? this.toDomain(record) : null;
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.findOneBy({ id, userId });
    return record ? this.toDomain(record) : null;
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
      await this.repository.save(this.repository.create(this.toRecord(deployment)));
    } catch (error: unknown) { throw this.translateError(error); }
  }

  public async update(deployment: Deployment): Promise<void> {
    try {
      await this.repository.update({ id: deployment.id, userId: deployment.userId }, this.toRecord(deployment));
    } catch (error: unknown) { throw this.translateError(error); }
  }

  public async delete(deploymentId: string, userId: string): Promise<void> {
    await this.repository.delete({ id: deploymentId, userId });
  }

  public async claimNextPending(): Promise<Deployment | null> {
    const record: InfraDeployment | null = await this.repository.createQueryBuilder("deployment")
      .where("deployment.status = :status", { status: "PENDING" })
      .andWhere("deployment.creation_request IS NOT NULL")
      .orderBy("deployment.createdAt", "ASC").addOrderBy("deployment.id", "ASC").getOne();
    if (!record) return null;
    const result: UpdateResult = await this.repository.createQueryBuilder().update(InfraDeployment)
      .set({ status: "PROVISIONING", updatedAt: new Date(), error: null })
      .where("id = :id AND user_id = :userId AND status = :status", { id: record.id, userId: record.userId, status: "PENDING" }).execute();
    return result.affected === 1 ? this.findByIdAndUserId(record.id, record.userId) : null;
  }

  public async failStaleProvisioning(before: Date): Promise<void> {
    await this.repository.createQueryBuilder().update(InfraDeployment)
      .set({ status: "FAILED", error: "Deployment provisioning was interrupted or timed out", updatedAt: new Date() })
      .where("status = :status AND updated_at < :before AND creation_request IS NOT NULL", { status: "PROVISIONING", before }).execute();
  }

  private toDomain(record: InfraDeployment): Deployment {
    return new Deployment({
      id: record.id, userId: record.userId, name: record.name, status: record.status,
      spec: record.requestJson ? JSON.parse(record.requestJson) as DeploymentSpec : null,
      image: record.image, buildId: record.buildId, resourceId: record.resourceId,
      fqdn: record.fqdn, error: record.error, createdAt: record.createdAt, updatedAt: record.updatedAt,
    });
  }

  private toRecord(deployment: Deployment): Partial<InfraDeployment> {
    return {
      id: deployment.id, userId: deployment.userId, name: deployment.name, status: deployment.status,
      requestJson: deployment.spec ? JSON.stringify(deployment.spec) : null,
      image: deployment.image, buildId: deployment.buildId, resourceId: deployment.resourceId,
      fqdn: deployment.fqdn, error: deployment.error, createdAt: deployment.createdAt, updatedAt: deployment.updatedAt,
    };
  }

  private translateError(error: unknown): unknown {
    const driver: unknown = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : error;
    if (typeof driver === "object" && driver !== null && "number" in driver && (driver.number === 2601 || driver.number === 2627)) {
      return new DeploymentAlreadyExists("A deployment with this name already exists for the user");
    }
    return error;
  }
}
