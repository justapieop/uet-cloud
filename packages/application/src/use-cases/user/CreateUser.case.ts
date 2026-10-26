import { Permission, Role, User, type PermissionDefinition } from "@kumo/domain";
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

    let defaultRole: Role | null = await repositories.roles.findByIdForUpdate("default");
    if (!defaultRole) {
      const permissions: readonly PermissionDefinition[] = [
        Permission.DeploymentRead, Permission.BuildRead, Permission.DeploymentMetricsRead,
        Permission.DeploymentCreate, Permission.DeploymentUpdate, Permission.DeploymentDelete,
      ];
      defaultRole = new Role({
        id: "default", name: "Default",
        permission: permissions.reduce((bits: bigint, permission: PermissionDefinition): bigint =>
          bits | (1n << BigInt(permission.offset)), 0n),
      });
      await repositories.roles.insert(defaultRole);
    }
    if (!defaultRole.active) throw new Error("Default role is inactive; new user registration is disabled");

    const superRole: Role | null = await repositories.roles.findByIdForUpdate("super");
    if (!superRole) {
      await repositories.roles.insert(new Role({
        id: "super", name: "Super", permission: 1n << BigInt(Permission.Super.offset),
      }));
    }

    const newUser: User = new User({
      id,
      displayName,
      createdAt: new Date(),
      suspended: false,
    });

    await repositories.users.save(newUser);
    await repositories.userRoles.replaceForUser(newUser.id, [defaultRole.id]);
    return newUser;
  }
}
