import type { UnitOfWork, UnitOfWorkRepositories } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { InfraDeploymentRequestRepository } from "./repositories/deployment-request.js";
import { InfraRole, InfraRoleRepository } from "./repositories/role.js";
import { InfraUserRole, InfraUserRoleRepository } from "./repositories/user-role.js";
import { InfraUser, InfraUserRepository } from "./repositories/user.js";
import { InfraDeployment, InfraDeploymentRepository } from "./repositories/deployment.js";
import { InfraPlan, InfraPlanRepository } from "./repositories/plan.js";
import { InfraVolume, InfraVolumeRepository } from "./repositories/volume.js";

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  public constructor(
    private readonly dataSource: DataSource,
  ) { }
  public run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: EntityManager): Promise<T> => {
      const repositories: UnitOfWorkRepositories = {
        users: new InfraUserRepository(manager.getRepository(InfraUser)),
        roles: new InfraRoleRepository(manager.getRepository(InfraRole)),
        userRoles: new InfraUserRoleRepository(manager.getRepository(InfraUserRole)),
        deployment: new InfraDeploymentRepository(manager.getRepository(InfraDeployment)),
        deploymentRequests: new InfraDeploymentRequestRepository(manager),
        plans: new InfraPlanRepository(manager.getRepository(InfraPlan)),
        volumes: new InfraVolumeRepository(manager.getRepository(InfraVolume)),
      };

      return work(repositories);
    });
  }
}
