import assert from "node:assert/strict";
import { test } from "node:test";
import { Role, User } from "@kumo/domain";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { CreateUserCase } from "../dist/use-cases/user/CreateUser.case.js";

function createRepositories(savedUsers: User[]): UnitOfWorkRepositories {
  return {
    users: {
      findById: async (id: string): Promise<User | null> =>
        savedUsers.find((user: User): boolean => user.id === id) ?? null,
      findByIdForUpdate: async (id: string): Promise<User | null> => savedUsers.find((user: User): boolean => user.id === id) ?? null,
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

function createUnitOfWork(repositories: UnitOfWorkRepositories): UnitOfWork {
  return {
    run<T>(work: (transactionRepositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
  };
}

test("createIfNotExists saves a missing user", async (): Promise<void> => {
  const savedUsers: User[] = [];
  const repositories: UnitOfWorkRepositories = createRepositories(savedUsers);
  const useCases: CreateUserCase = new CreateUserCase(createUnitOfWork(repositories));

  const created: User = await useCases.exec("user-1", "User One");

  assert.equal(savedUsers.length, 1);
  assert.strictEqual(savedUsers[0], created);
});

test("createIfNotExists returns an existing user without another write", async (): Promise<void> => {
  const savedUsers: User[] = [];
  const repositories: UnitOfWorkRepositories = createRepositories(savedUsers);
  const useCases: CreateUserCase = new CreateUserCase(createUnitOfWork(repositories));

  const created: User = await useCases.exec("user-1", "User One");
  const existing: User = await useCases.exec("user-1", "Ignored Name");

  assert.equal(savedUsers.length, 1);
  assert.strictEqual(existing, created);
});
