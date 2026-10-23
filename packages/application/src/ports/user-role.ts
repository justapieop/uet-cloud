import type { Role } from "@kumo/domain";

export interface UserRoleRepository {
  findByUserId(userId: string): Promise<Role[]>;
  replaceForUser(userId: string, roleIds: readonly string[]): Promise<void>;
}
