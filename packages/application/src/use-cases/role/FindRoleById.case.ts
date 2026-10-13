import type { Role } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/index.js";

export class FindRoleByIdCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }

  public exec(id: string): Promise<Role | null> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.findRoleById(repo, id));
  }

  private async findRoleById(repo: UnitOfWorkRepositories, id: string): Promise<Role | null> {
    return await repo.roles.findById(id);
  }
}