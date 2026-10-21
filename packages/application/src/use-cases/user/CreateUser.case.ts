import { User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export class CreateUserCase {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public exec(id: string, displayName: string): Promise<User> {
    return this.unitOfWork.run((repositories: UnitOfWorkRepositories): Promise<User> =>
      this.createIfNotExists(repositories, id, displayName));
  }

  private async createIfNotExists(
    repositories: UnitOfWorkRepositories,
    id: string,
    displayName: string,
  ): Promise<User> {
    const existingUser: User | null = await repositories.users.findByIdForUpdate(id);

    if (existingUser) {
      return existingUser;
    }

    const newUser: User = new User({
      id,
      displayName,
      createdAt: new Date(),
      suspended: false,
    });

    await repositories.users.save(newUser);
    return newUser;
  }
}
