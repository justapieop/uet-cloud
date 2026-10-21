import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "@kumo/domain";
import { SessionSerializer } from "../dist/auth/serializer.js";

function createSerializer(findById: (id: string) => Promise<User | null>): SessionSerializer {
  return new SessionSerializer({ read: async (id: string) => {
    const user: User | null = await findById(id);
    return user ? { user, permissionBits: 0n } : null;
  } });
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
