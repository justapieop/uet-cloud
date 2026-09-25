import type { User } from "@kumo/domain";
import type { UserRepository } from "../ports/user.js";

export class GetUserByIdUseCase {
  public constructor(private readonly users: UserRepository) {}

  public execute(id: string): Promise<User | null> {
    return this.users.findById(id);
  }
}
