import { type VolumeRepository } from "@kumo/application";
import { Volume } from "@kumo/domain";
import { Column, Entity, Index, PrimaryColumn, type Repository } from "typeorm";

@Entity({ name: "volumes" })
@Index("UQ_volumes_user_name", ["userId", "name"], { unique: true })
@Index("IDX_volumes_user_id", ["userId"])
export class InfraVolume {
  @PrimaryColumn({ type: "nvarchar", length: 255 })
  public readonly id!: string;

  @Column({ type: "nvarchar", length: 255, name: "user_id" })
  public readonly userId!: string;

  @Column({ type: "nvarchar", length: 64 })
  public readonly name!: string;

  @Column({ type: "int", name: "size_gb" })
  public readonly sizeGb!: number;

  @Column({ type: "nvarchar", length: 64 })
  public readonly region!: string;

  @Column({ type: "datetime2", precision: 7, name: "created_at" })
  public readonly createdAt!: Date;

  @Column({ type: "datetime2", precision: 7, name: "updated_at" })
  public readonly updatedAt!: Date;
}

export class InfraVolumeRepository implements VolumeRepository {
  public constructor(private readonly repository: Repository<InfraVolume>) {}

  public async findById(id: string): Promise<Volume | null> {
    const record: InfraVolume | null = await this.repository.findOneBy({ id });
    return record ? this.toDomain(record) : null;
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Volume | null> {
    const record: InfraVolume | null = await this.repository.findOneBy({ id, userId });
    return record ? this.toDomain(record) : null;
  }

  public async findByNameAndUserId(name: string, userId: string): Promise<Volume | null> {
    const record: InfraVolume | null = await this.repository.findOneBy({ name, userId });
    return record ? this.toDomain(record) : null;
  }

  public async findByUserId(userId: string): Promise<Volume[]> {
    const records: InfraVolume[] = await this.repository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    return records.map((record: InfraVolume): Volume => this.toDomain(record));
  }

  public async save(volume: Volume): Promise<void> {
    await this.repository.save(this.toRecord(volume));
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  private toDomain(record: InfraVolume): Volume {
    return new Volume({
      id: record.id,
      userId: record.userId,
      name: record.name,
      sizeGb: record.sizeGb,
      region: record.region,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private toRecord(volume: Volume): InfraVolume {
    const record: InfraVolume = new InfraVolume();
    (record as { id: string }).id = volume.id;
    (record as { userId: string }).userId = volume.userId;
    (record as { name: string }).name = volume.name;
    (record as { sizeGb: number }).sizeGb = volume.sizeGb;
    (record as { region: string }).region = volume.region;
    (record as { createdAt: Date }).createdAt = volume.createdAt;
    (record as { updatedAt: Date }).updatedAt = volume.updatedAt;
    return record;
  }
}
