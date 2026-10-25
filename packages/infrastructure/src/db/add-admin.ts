import { Permission, User } from "@kumo/domain";
import type { DataSource, EntityManager } from "typeorm";
import { acquireBootstrapLock } from "./bootstrap-lock.js";
import { InfraRole } from "./repositories/role.js";
import { InfraUser } from "./repositories/user.js";
import { InfraUserRole } from "./repositories/user-role.js";

export class AdminBootstrapError extends Error {}
export interface AddAdminResult { userCreated: boolean; roleCreated: boolean; assignmentCreated: boolean; }

export function validateGithubUserId(githubId: string): void {
  if (typeof githubId !== "string" || !/^[1-9][0-9]{0,254}$/.test(githubId)) {
    throw new AdminBootstrapError("Supply a positive numeric GitHub user ID, not a username");
  }
}

export async function addGithubAdmin(source: DataSource, githubId: string): Promise<AddAdminResult> {
  validateGithubUserId(githubId);
  return source.transaction("SERIALIZABLE", async (manager: EntityManager): Promise<AddAdminResult> => {
    await acquireBootstrapLock(manager);
    // Lock the identity while checking eligibility, including the range for a missing row.
    const user: InfraUser | null = await manager.findOne(InfraUser, {
      where: { id: githubId }, lock: { mode: "pessimistic_write" },
    });
    if (user && (!user.active || user.suspended)) throw new AdminBootstrapError("Cannot promote an inactive or suspended user");
    const role: InfraRole | null = await manager.findOne(InfraRole, {
      where: { id: "admin" }, lock: { mode: "pessimistic_write" },
    });
    if (role && !role.active) throw new AdminBootstrapError("The admin role is disabled; reactivate it explicitly before assigning it");
    if (!user) {
      const created: User = new User({ id: githubId, displayName: githubId, active: true, suspended: false });
      // Offline bootstrap: OAuth links the Stripe Customer on the user's first login.
      await manager.insert(InfraUser, { id: created.id, displayName: created.displayName, active: true, suspended: false, stripeCustomerId: null });
    }
    const superMask: bigint = 1n << BigInt(Permission.Super.offset);
    if (!role) await manager.insert(InfraRole, { id: "admin", name: "Administrator", active: true, permission: superMask });
    else if ((role.permission & superMask) === 0n) await manager.update(InfraRole, { id: "admin" }, { permission: role.permission | superMask });
    const assigned: boolean = await manager.existsBy(InfraUserRole, { userId: githubId, roleId: "admin" });
    if (!assigned) await manager.insert(InfraUserRole, { userId: githubId, roleId: "admin" });
    return { userCreated: !user, roleCreated: !role, assignmentCreated: !assigned };
  });
}
