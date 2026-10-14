import type { UnitOfWork, UnitOfWorkRepositories } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { InfraRole, InfraRoleRepository } from "./repositories/role.js";
import { InfraUser, InfraUserRepository } from "./repositories/user.js";
import { InfraDeployment, InfraDeploymentRepository } from "./repositories/deployment.js";

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
        deployment: new InfraDeploymentRepository(manager.getRepository(InfraDeployment)),
      };

      return work(repositories);
    });
  }
}
