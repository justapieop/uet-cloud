import type { Role } from "@kumo/domain";

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findByIds(ids: readonly string[]): Promise<Role[]>;
  findAll(): Promise<Role[]>;
  findActiveByUserId(userId: string): Promise<Role[]>;
  save(role: Role): Promise<void>;
  insert(role: Role): Promise<void>;
  replace(role: Role): Promise<void>;
  deactivate(id: string): Promise<void>;
}

export class RoleManagementNotFound extends Error {}
export class RoleManagementConflict extends Error {}
export class RoleManagementForbidden extends Error {}
