import type { Role, User } from "@kumo/domain";
import { RoleManagementNotFound } from "../../ports/role.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface UserRoleAssignments {
  readonly user: User;
  readonly roles: Role[];
}

export class GetUserRoleAssignmentsCase {
  public constructor(private readonly uow: UnitOfWork) {}

  public exec(userId: string): Promise<UserRoleAssignments> {
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<UserRoleAssignments> => {
      const user: User | null = await repositories.users.findById(userId);
      if (!user) {
        throw new RoleManagementNotFound("User not found");
      }

      const roles: Role[] = await repositories.userRoles.findByUserId(userId);

      return { user, roles };
    });
  }
}
