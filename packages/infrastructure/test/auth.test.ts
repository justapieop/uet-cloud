import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { CreateUserCase, type UnitOfWork, type UnitOfWorkRepositories } from "@kumo/application";
import { Role, User } from "@kumo/domain";
import type { Profile } from "passport-github2";
import { PassportProvider } from "../dist/auth/provider.js";

test("GitHub strategy returns the user created in one unit of work", async (): Promise<void> => {
  const savedUsers: User[] = [];
  let transactionCalls: number = 0;
  const repositories: UnitOfWorkRepositories = {
    users: {
      findById: async (): Promise<User | null> => null,
      save: async (user: User): Promise<void> => { savedUsers.push(user); },
      exists: async (): Promise<boolean> => false,
    },
    roles: {
      findById: async (): Promise<Role | null> => null,
      save: async (): Promise<void> => {},
    },
  };
  const unitOfWork: UnitOfWork = {
    run<T>(work: (transactionRepositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      transactionCalls++;
      return work(repositories);
    },
  };
  const configService: ConfigService = {
    getOrThrow: (key: string): string => key === "GITHUB_OAUTH2_REDIRECT_URL"
      ? "http://localhost:3000/auth/callback"
      : "test-value",
  } as unknown as ConfigService;
  const provider: PassportProvider = new PassportProvider(configService, new CreateUserCase(unitOfWork));
  const profile: Profile = {
    provider: "github",
    id: "123",
    displayName: "",
    username: "alice",
    profileUrl: "https://github.com/alice",
  };

  const user: User = await provider.validate("access-token", "", profile);

  assert.equal(transactionCalls, 1);
  assert.strictEqual(savedUsers[0], user);
  assert.equal(user.id, "123");
  assert.equal(user.displayName, "alice");
});
