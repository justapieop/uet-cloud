import type { Role } from "@kumo/domain";

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findActiveByUserId(userId: string): Promise<Role[]>;
  save(role: Role): Promise<void>;
}
