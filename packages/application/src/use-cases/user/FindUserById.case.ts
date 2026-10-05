import { User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export class FindUserByIdCase {
  public constructor(private readonly unitOfWork: UnitOfWork) { }

  public exec(id: string): Promise<User | null> {
    return this.unitOfWork.run((repositories: UnitOfWorkRepositories): Promise<User | null> =>
      this.createIfNotExists(repositories, id));
  }

  private async createIfNotExists(
    repositories: UnitOfWorkRepositories,
    id: string,
  ): Promise<User | null> {
    return await repositories.users.findById(id);
  }
}
