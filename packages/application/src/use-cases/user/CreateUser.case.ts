import { User } from "@kumo/domain";
import type { LinkStripeCustomerCase } from "./LinkStripeCustomer.case.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export class CreateUserCase {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly linkStripeCustomer: Pick<LinkStripeCustomerCase, "exec">,
  ) {}

  public async exec(id: string, displayName: string): Promise<User> {
    const user: User = await this.unitOfWork.run((repositories: UnitOfWorkRepositories): Promise<User> =>
      this.createIfNotExists(repositories, id, displayName));
    if (user.suspended || user.stripeCustomerId) return user;
    // Commit local user creation before any network request.
    return this.linkStripeCustomer.exec(user.id);
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
