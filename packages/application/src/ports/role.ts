import type { Role } from "@kumo/domain";

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  save(role: Role): Promise<void>;
}
