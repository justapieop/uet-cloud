import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "@kumo/domain";
import type { Repository } from "typeorm";
import { InfraUserRepository, type InfraUser } from "../dist/db/repositories/user.js";

test("user repository preserves active false through saving and loading", async (): Promise<void> => {
  const user: User = new User({ id: "123", displayName: "Alice", suspended: false, active: false });
  let saved: Partial<InfraUser> | undefined;
  const orm: Repository<InfraUser> = {
    create: (record: Partial<InfraUser>): Partial<InfraUser> => record,
    save: async (record: Partial<InfraUser>): Promise<void> => { saved = record; },
    findOneBy: async (): Promise<Partial<InfraUser> | null> => saved ?? null,
  } as unknown as Repository<InfraUser>;
  const repository: InfraUserRepository = new InfraUserRepository(orm);
  await repository.save(user);
  assert.equal(saved?.active, false);
  assert.equal((await repository.findById(user.id))?.active, false);
  assert.equal(Object.hasOwn(saved!, "stripeCustomerId"), false);
});
