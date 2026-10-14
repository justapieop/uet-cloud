import type { DeploymentRepository } from "./deployment.js";
import type { RoleRepository } from "./role.js";
import type { UserRepository } from "./user.js";

export interface UnitOfWorkRepositories {
  users: UserRepository;
  roles: RoleRepository;
  deployment: DeploymentRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK: symbol = Symbol("UNIT_OF_WORK");
