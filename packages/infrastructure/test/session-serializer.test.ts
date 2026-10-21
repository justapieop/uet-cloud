import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "@kumo/domain";
import { FindUserByIdCase, type UnitOfWork, type UnitOfWorkRepositories } from "@kumo/application";
import { SessionSerializer } from "../dist/auth/serializer.js";
import { emptyRepositories } from "../../application/test/support/repositories.ts";

function createSerializer(findById: (id: string) => Promise<User | null>): SessionSerializer {
  const repositories: UnitOfWorkRepositories = {
    ...emptyRepositories(),
    users: {
      findById,
      findByIdForUpdate: async (): Promise<never> => { throw new Error("Session restoration must not lock users"); },
      save: async (): Promise<void> => { assert.fail("Session restoration must not save users"); },
      exists: async (): Promise<boolean> => { assert.fail("Session restoration must only find users"); },
    },
    roles: {
      findById: async (): Promise<null> => null,
      save: async (): Promise<void> => {},
    },
  };
  const unitOfWork: UnitOfWork = {
    run<T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
  };
  return new SessionSerializer(new FindUserByIdCase(unitOfWork));
}

test("session serialization stores only the user ID", (): void => {
  const user: User = new User({ id: "123", displayName: "Alice", suspended: false });
  const serializer: SessionSerializer = createSerializer(async (): Promise<User | null> => {
    assert.fail("Serialization must not query the database");
  });
  let callbackCalls: number = 0;

  serializer.serializeUser(user, (error: unknown, id?: string): void => {
    callbackCalls++;
    assert.equal(error, null);
    assert.equal(id, user.id);
  });

  assert.equal(callbackCalls, 1);
});

test("session deserialization restores the current domain user", async (): Promise<void> => {
  const user: User = new User({ id: "123", displayName: "Updated name", suspended: true });
  const lookedUpIds: string[] = [];
  const serializer: SessionSerializer = createSerializer(async (id: string): Promise<User | null> => {
    lookedUpIds.push(id);
    return user;
  });
  let callbackCalls: number = 0;

  await serializer.deserializeUser("123", (error: unknown, restoredUser?: User | false): void => {
    callbackCalls++;
    assert.equal(error, null);
    assert.strictEqual(restoredUser, user);
  });

  assert.deepEqual(lookedUpIds, ["123"]);
  assert.equal(callbackCalls, 1);
});

test("sessions for deleted users are rejected", async (): Promise<void> => {
  const serializer: SessionSerializer = createSerializer(async (): Promise<User | null> => null);
  let callbackCalls: number = 0;

  await serializer.deserializeUser("deleted-user", (error: unknown, user?: User | false): void => {
    callbackCalls++;
    assert.equal(error, null);
    assert.equal(user, false);
  });

  assert.equal(callbackCalls, 1);
});

test("malformed session payloads are rejected without database access", async (): Promise<void> => {
  const serializer: SessionSerializer = createSerializer(async (): Promise<User | null> => {
    assert.fail("Invalid session payloads must not query the database");
  });
  const payloads: unknown[] = [undefined, null, false, 123, {}, [], "", "   "];
  let callbackCalls: number = 0;

  for (let index: number = 0; index < payloads.length; index++) {
    const payload: unknown = payloads[index];
    await serializer.deserializeUser(payload, (error: unknown, user?: User | false): void => {
      callbackCalls++;
      assert.equal(error, null);
      assert.equal(user, false);
    });
  }

  assert.equal(callbackCalls, payloads.length);
});

test("database failures are passed to Passport exactly once", async (): Promise<void> => {
  const failure: Error = new Error("Database unavailable");
  const serializer: SessionSerializer = createSerializer(async (): Promise<User | null> => {
    throw failure;
  });
  let callbackCalls: number = 0;

  await serializer.deserializeUser("123", (error: unknown, user?: User | false): void => {
    callbackCalls++;
    assert.strictEqual(error, failure);
    assert.equal(user, undefined);
  });

  assert.equal(callbackCalls, 1);
});
