import { Permission, Role, User } from "@kumo/domain";
import { RootLoginDisabled, RootLoginRejected, type RootPasswordVerifier } from "../../ports/root-login.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export class RootLoginCase {
  public constructor(private readonly uow: UnitOfWork, private readonly verifier: RootPasswordVerifier) {}

  public async exec(password: string): Promise<User> {
    if (!this.verifier.enabled) throw new RootLoginDisabled();
    if (!await this.verifier.verify(password)) throw new RootLoginRejected();
    return this.uow.run(async (repositories: UnitOfWorkRepositories): Promise<User> => {
      const existing: User | null = await repositories.users.findByIdForUpdate("root");
      if (existing) {
        if (!existing.active || existing.suspended) throw new RootLoginRejected();
        const roles: Role[] = await repositories.roles.findActiveByUserId(existing.id);
        if (!roles.some((role: Role): boolean => role.hasPermission(Permission.Super))) throw new RootLoginRejected();
        return existing;
      }
      let role: Role | null = await repositories.roles.findByIdForUpdate("super");
      if (!role) {
        role = new Role({ id: "super", name: "Super", permission: 1n << BigInt(Permission.Super.offset) });
        await repositories.roles.insert(role);
      }
      if (!role.active || !role.hasPermission(Permission.Super)) throw new RootLoginRejected();
      const root: User = new User({ id: "root", displayName: "Root", active: true, suspended: false });
      await repositories.users.save(root);
      await repositories.userRoles.replaceForUser(root.id, [role.id]);
      return root;
    });
  }
}
