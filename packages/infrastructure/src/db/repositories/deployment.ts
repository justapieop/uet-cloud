import { randomUUID } from "node:crypto";
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
  EntityManager,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
  Repository,
  UpdateDateColumn,
} from "typeorm";

@Entity({
  name: "deployment_specs",
})
export class InfraDeploymentSpec {
  @PrimaryColumn({
    type: "nvarchar",
    length: 255,
  })
  public readonly id!: string;

  @Column({
    type: "nvarchar",
    length: 255,
    name: "deployment_id",
    nullable: false,
    unique: true,
  })
  public readonly deploymentId!: string;

  @Column({
    type: "nvarchar",
    length: 1024,
    nullable: false,
  })
  public readonly image!: string;

  @Column({
    type: "int",
    name: "target_port",
    nullable: false,
  })
  public readonly targetPort!: number;

  @Column({
    type: "float",
    nullable: false,
    default: 0.25,
  })
  public readonly cpu!: number;

  @Column({
    type: "float",
    nullable: false,
    default: 0.5,
  })
  public readonly memory!: number;

  @Column({
    type: "int",
    name: "min_replicas",
    nullable: false,
    default: 0,
  })
  public readonly minReplicas!: number;

  @Column({
    type: "int",
    name: "max_replicas",
    nullable: false,
    default: 2,
  })
  public readonly maxReplicas!: number;

  @Column({
    type: "nvarchar",
    length: "MAX",
    name: "env_vars",
    nullable: true,
    transformer: {
      to(value: Record<string, string> | null | undefined): string | null {
        return value ? JSON.stringify(value) : null;
      },
      from(value: string | null | undefined): Record<string, string> | null {
        return value ? (JSON.parse(value) as Record<string, string>) : null;
      },
    },
  })
  public readonly envVars!: Record<string, string> | null;

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

  @OneToOne(
    (): typeof InfraDeployment => InfraDeployment,
    (deployment: InfraDeployment): InfraDeploymentSpec | undefined => deployment.spec,
    {
      onDelete: "CASCADE",
    },
  )
  @JoinColumn({ name: "deployment_id" })
  public readonly deployment?: Relation<InfraDeployment>;
}

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

  @OneToOne(
    (): typeof InfraDeploymentSpec => InfraDeploymentSpec,
    (spec: InfraDeploymentSpec): InfraDeployment | undefined => spec.deployment,
    {
      cascade: true,
      eager: true,
    },
  )
  public readonly spec?: Relation<InfraDeploymentSpec>;

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
    @InjectRepository(InfraDeploymentSpec)
    private readonly specRepository: Repository<InfraDeploymentSpec>,
  ) {}

  public async findById(id: string): Promise<Deployment | null> {
    const dbDeployment: InfraDeployment | null =
      await this.deploymentRepository.findOne({
        where: { id },
        relations: { spec: true },
      });

    return dbDeployment ? this.toDomain(dbDeployment) : null;
  }

  public async findByIdAndUserId(
    id: string,
    userId: string,
  ): Promise<Deployment | null> {
    const dbDeployment: InfraDeployment | null =
      await this.deploymentRepository.findOne({
        where: { id, userId },
        relations: { spec: true },
      });

    return dbDeployment ? this.toDomain(dbDeployment) : null;
  }

  public async findByUserId(userId: string): Promise<Deployment[]> {
    const dbDeployments: InfraDeployment[] =
      await this.deploymentRepository.find({
        where: { userId },
        relations: { spec: true },
      });

    return dbDeployments.map(
      (dbDeployment: InfraDeployment): Deployment =>
        this.toDomain(dbDeployment),
    );
  }

  public async save(deployment: Deployment): Promise<void> {
    await this.deploymentRepository.manager.transaction(
      async (manager: EntityManager): Promise<void> => {
        const deploymentRepo: Repository<InfraDeployment> =
          manager.getRepository(InfraDeployment);
        const specRepo: Repository<InfraDeploymentSpec> =
          manager.getRepository(InfraDeploymentSpec);

        const dbDeployment: InfraDeployment = deploymentRepo.create({
          id: deployment.id,
          userId: deployment.userId,
          name: deployment.name,
          status: deployment.status,
          fqdn: deployment.fqdn,
          errorMessage: deployment.errorMessage,
          createdAt: deployment.createdAt,
          updatedAt: deployment.updatedAt,
        });
        await deploymentRepo.save(dbDeployment);

        const existingSpec: InfraDeploymentSpec | null =
          await specRepo.findOneBy({ deploymentId: deployment.id });

        const dbSpec: InfraDeploymentSpec = specRepo.create({
          id: existingSpec?.id ?? randomUUID(),
          deploymentId: deployment.id,
          image: deployment.spec.image,
          targetPort: deployment.spec.targetPort,
          cpu: deployment.spec.resources?.cpu ?? 0.25,
          memory: deployment.spec.resources?.memory ?? 0.5,
          minReplicas: deployment.spec.scaling?.minReplicas ?? 0,
          maxReplicas: deployment.spec.scaling?.maxReplicas ?? 2,
          envVars: deployment.spec.envVars ?? null,
          createdAt: existingSpec?.createdAt ?? deployment.createdAt,
          updatedAt: deployment.updatedAt,
        });
        await specRepo.save(dbSpec);
      },
    );
  }

  public async update(deployment: Deployment): Promise<void> {
    await this.save(deployment);
  }

  public async updateMany(deployments: Deployment[]): Promise<void> {
    if (deployments.length === 0) {
      return;
    }

    await this.deploymentRepository.manager.transaction(
      async (manager: EntityManager): Promise<void> => {
        const deploymentRepo: Repository<InfraDeployment> =
          manager.getRepository(InfraDeployment);
        const specRepo: Repository<InfraDeploymentSpec> =
          manager.getRepository(InfraDeploymentSpec);

        for (const deployment of deployments) {
          const dbDeployment: InfraDeployment = deploymentRepo.create({
            id: deployment.id,
            userId: deployment.userId,
            name: deployment.name,
            status: deployment.status,
            fqdn: deployment.fqdn,
            errorMessage: deployment.errorMessage,
            createdAt: deployment.createdAt,
            updatedAt: deployment.updatedAt,
          });
          await deploymentRepo.save(dbDeployment);

          const existingSpec: InfraDeploymentSpec | null =
            await specRepo.findOneBy({ deploymentId: deployment.id });

          const dbSpec: InfraDeploymentSpec = specRepo.create({
            id: existingSpec?.id ?? randomUUID(),
            deploymentId: deployment.id,
            image: deployment.spec.image,
            targetPort: deployment.spec.targetPort,
            cpu: deployment.spec.resources?.cpu ?? 0.25,
            memory: deployment.spec.resources?.memory ?? 0.5,
            minReplicas: deployment.spec.scaling?.minReplicas ?? 0,
            maxReplicas: deployment.spec.scaling?.maxReplicas ?? 2,
            envVars: deployment.spec.envVars ?? null,
            createdAt: existingSpec?.createdAt ?? deployment.createdAt,
            updatedAt: deployment.updatedAt,
          });
          await specRepo.save(dbSpec);
        }
      },
    );
  }

  private toDomain(dbDeployment: InfraDeployment): Deployment {
    const spec: DeploymentSpec = dbDeployment.spec
      ? {
          image: dbDeployment.spec.image,
          targetPort: dbDeployment.spec.targetPort,
          resources: {
            cpu: dbDeployment.spec.cpu,
            memory: dbDeployment.spec.memory,
          },
          scaling: {
            minReplicas: dbDeployment.spec.minReplicas,
            maxReplicas: dbDeployment.spec.maxReplicas,
          },
          envVars: dbDeployment.spec.envVars ?? null,
        }
      : {
          image: "",
          targetPort: 80,
          resources: {
            cpu: 0.25,
            memory: 0.5,
          },
          scaling: {
            minReplicas: 0,
            maxReplicas: 2,
          },
          envVars: null,
        };

    return new Deployment({
      id: dbDeployment.id,
      userId: dbDeployment.userId,
      name: dbDeployment.name,
      status: dbDeployment.status,
      spec,
      fqdn: dbDeployment.fqdn,
      errorMessage: dbDeployment.errorMessage,
      createdAt: dbDeployment.createdAt,
      updatedAt: dbDeployment.updatedAt,
    });
  }
}
