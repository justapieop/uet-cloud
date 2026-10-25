import type { User } from "@kumo/domain";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Called inside a UoW; serializes creation even when the user row does not exist yet. */
  findByIdForUpdate(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
  exists(id: string): Promise<boolean>;
}
