import type { DeploymentRepository } from "@kumo/application";
import {
  Deployment,
  type DeploymentSpec,
  type DeploymentStatus,
} from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Repository,
  UpdateDateColumn,
} from "typeorm";

@Entity({
  name: "deployments",
})
export class InfraDeployment {
  @PrimaryColumn({
    type: "nvarchar",
    length: 255,
  })
  public readonly id!: string;

  @Column({
    type: "nvarchar",
    length: 255,
    name: "user_id",
    nullable: false,
  })
  public readonly userId!: string;

  @Column({
    type: "nvarchar",
    length: 32,
    nullable: false,
  })
  public readonly name!: string;

  @Column({
    type: "nvarchar",
    length: 32,
    nullable: false,
  })
  public readonly status!: DeploymentStatus;

  @Column({
    type: "nvarchar",
    length: "MAX",
    nullable: false,
    transformer: {
      to(value: DeploymentSpec): string {
        return JSON.stringify(value);
      },
      from(value: string): DeploymentSpec {
        return JSON.parse(value) as DeploymentSpec;
      },
    },
  })
  public readonly spec!: DeploymentSpec;

  @Column({
    type: "nvarchar",
    length: 2048,
    nullable: true,
  })
  public readonly fqdn!: string | null;

  @Column({
    type: "nvarchar",
    length: 1000,
    name: "error_message",
    nullable: true,
  })
  public readonly errorMessage!: string | null;

  @CreateDateColumn({
    type: "datetime2",
    name: "created_at",
  })
  public readonly createdAt!: Date;

  @UpdateDateColumn({
    type: "datetime2",
    name: "updated_at",
  })
  public readonly updatedAt!: Date;
}

@Injectable()
export class InfraDeploymentRepository implements DeploymentRepository {
  public constructor(
    @InjectRepository(InfraDeployment)
    private readonly deploymentRepository: Repository<InfraDeployment>,
  ) {}

  public async findById(id: string): Promise<Deployment | null> {
    const dbDeployment: InfraDeployment | null =
      await this.deploymentRepository.findOneBy({ id });

    return dbDeployment ? this.toDomain(dbDeployment) : null;
  }

  public async findByIdAndUserId(
    id: string,
    userId: string,
  ): Promise<Deployment | null> {
    const dbDeployment: InfraDeployment | null =
      await this.deploymentRepository.findOneBy({ id, userId });

    return dbDeployment ? this.toDomain(dbDeployment) : null;
  }

  public async findByUserId(userId: string): Promise<Deployment[]> {
    const dbDeployments: InfraDeployment[] =
      await this.deploymentRepository.findBy({ userId });

    return dbDeployments.map(
      (dbDeployment: InfraDeployment): Deployment =>
        this.toDomain(dbDeployment),
    );
  }

  public async save(deployment: Deployment): Promise<void> {
    const dbDeployment: InfraDeployment = this.toDatabase(deployment);
    await this.deploymentRepository.save(dbDeployment);
  }

  public async update(deployment: Deployment): Promise<void> {
    await this.save(deployment);
  }

  public async updateMany(deployments: Deployment[]): Promise<void> {
    if (deployments.length === 0) {
      return;
    }

    const dbDeployments: InfraDeployment[] = deployments.map(
      (deployment: Deployment): InfraDeployment =>
        this.toDatabase(deployment),
    );
    await this.deploymentRepository.save(dbDeployments);
  }

  private toDomain(dbDeployment: InfraDeployment): Deployment {
    return new Deployment({
      id: dbDeployment.id,
      userId: dbDeployment.userId,
      name: dbDeployment.name,
      status: dbDeployment.status,
      spec: dbDeployment.spec,
      fqdn: dbDeployment.fqdn,
      errorMessage: dbDeployment.errorMessage,
      createdAt: dbDeployment.createdAt,
      updatedAt: dbDeployment.updatedAt,
    });
  }

  private toDatabase(deployment: Deployment): InfraDeployment {
    return this.deploymentRepository.create({
      id: deployment.id,
      userId: deployment.userId,
      name: deployment.name,
      status: deployment.status,
      spec: deployment.spec,
      fqdn: deployment.fqdn,
      errorMessage: deployment.errorMessage,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    });
  }
}
