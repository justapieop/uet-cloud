import type { DeploymentRepository } from "@kumo/application";
import { Deployment } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, CreateDateColumn, Entity, PrimaryColumn, Repository } from "typeorm";

@Entity({
  name: "deployments",
})
export class InfraDeployment {
  @PrimaryColumn()
  public readonly id!: string;

  @PrimaryColumn({
    name: "user_id",
  })
  public readonly userId!: string;

  @Column({
    type: "text",
  })
  public readonly name!: string;

  @CreateDateColumn({
    name: "created_at",
  })
  public readonly createdAt!: Date;
}

@Injectable()
export class InfraDeploymentRepository implements DeploymentRepository {
  public constructor(
    @InjectRepository(InfraDeployment)
    private readonly repository: Repository<InfraDeployment>,
  ) {}

  public async findById(id: string): Promise<Deployment | null> {
    const infraDeployment: InfraDeployment | null = await this.repository.findOneBy({ id, });

    if (!infraDeployment) {
      return null;
    }

    return new Deployment({
      id: infraDeployment.id,
      userId: infraDeployment.userId,
      name: infraDeployment.name,
      createdAt: infraDeployment.createdAt,
    });
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Deployment | null> {
    const infraDeployment: InfraDeployment | null = await this.repository.findOneBy({ id, userId, });

    if (!infraDeployment) {
      return null;
    }

    return new Deployment({
      id: infraDeployment.id,
      userId: infraDeployment.userId,
      name: infraDeployment.name,
      createdAt: infraDeployment.createdAt,
    });
  }

  public async findByUserId(userId: string): Promise<Deployment[]> {
    const list: InfraDeployment[] = await this.repository.findBy({ userId, });

    return list.map((infraDeployment: InfraDeployment) => new Deployment({
      id: infraDeployment.id,
      userId: infraDeployment.userId,
      name: infraDeployment.name,
      createdAt: infraDeployment.createdAt,
    }));
  }

  public async save(deployment: Deployment): Promise<void> {
    const dbDeployment: InfraDeployment = this.repository.create(deployment);

    await this.repository.save(dbDeployment);
  }

  public async update(deployment: Deployment): Promise<void> {
    await this.repository.update({
      id: deployment.id,
    }, {
      name: deployment.name,
    });
  }

  public async delete(deploymentId: string, userId: string): Promise<void> {
    await this.repository.delete({ id: deploymentId, userId, });
  }
}