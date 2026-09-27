import assert from "node:assert/strict";
import { test } from "node:test";
import { Role, User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { UserUseCases } from "../dist/use-cases/user.js";

function createRepositories(savedUsers: User[]): UnitOfWorkRepositories {
  return {
    users: {
      findById: async (id: string): Promise<User | null> =>
        savedUsers.find((user: User): boolean => user.id === id) ?? null,
      save: async (user: User): Promise<void> => { savedUsers.push(user); },
      exists: async (id: string): Promise<boolean> =>
        savedUsers.some((user: User): boolean => user.id === id),
    },
    roles: {
      findById: async (): Promise<Role | null> => null,
      save: async (): Promise<void> => {},
    },
  };
}

test("createIfNotExists opens a unit of work for a standalone call", async (): Promise<void> => {
  const savedUsers: User[] = [];
  const repositories: UnitOfWorkRepositories = createRepositories(savedUsers);
  let transactionCalls: number = 0;
  const unitOfWork: UnitOfWork = {
    run<T>(work: (transactionRepositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      transactionCalls++;
      return work(repositories);
    },
  };
  const useCases: UserUseCases = new UserUseCases(unitOfWork);

  const created: User = await useCases.createIfNotExists("user-1", "User One");
  const existing: User = await useCases.createIfNotExists("user-1", "Ignored Name");

  assert.equal(transactionCalls, 2);
  assert.equal(savedUsers.length, 1);
  assert.strictEqual(existing, created);
});

test("createIfNotExistsIn joins an outer unit of work", async (): Promise<void> => {
  const savedUsers: User[] = [];
  const repositories: UnitOfWorkRepositories = createRepositories(savedUsers);
  let transactionCalls: number = 0;
  const unitOfWork: UnitOfWork = {
    run<T>(work: (transactionRepositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      transactionCalls++;
      return work(repositories);
    },
  };
  const useCases: UserUseCases = new UserUseCases(unitOfWork);

  await unitOfWork.run(async (transactionRepositories: UnitOfWorkRepositories): Promise<void> => {
    await useCases.createIfNotExistsIn(transactionRepositories, "user-1", "User One");
    await useCases.createIfNotExistsIn(transactionRepositories, "user-2", "User Two");
  });

  assert.equal(transactionCalls, 1);
  assert.deepEqual(savedUsers.map((user: User): string => user.id), ["user-1", "user-2"]);
});
