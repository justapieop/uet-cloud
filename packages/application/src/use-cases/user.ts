import { User } from "@kumo/domain";
import type { UnitOfWorkRepositories } from "../ports/uow.js";

export class UserUseCases {
  public async createIfNotExists(
    repositories: UnitOfWorkRepositories,
    id: string,
    displayName: string,
  ): Promise<User> {
    const existingUser: User | null = await repositories.users.findById(id);

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
