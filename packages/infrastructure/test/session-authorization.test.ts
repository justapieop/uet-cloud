import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DataSource } from "typeorm";
import { InfraSessionAuthorizationReader } from "../dist/auth/session-authorization.js";

test("authorization restores users and active role bits with one joined read on every request", async (): Promise<void> => {
  let calls: number = 0;
  let permissions: (string | null)[] = ["2", "4", null];
  const reader: InfraSessionAuthorizationReader = new InfraSessionAuthorizationReader({ query: async (sql: string, params: unknown[]): Promise<unknown[]> => {
    calls++; assert.deepEqual(params, ["123"]);
    return permissions.map((permission: string | null): object => ({ id: "123", display_name: "Alice", active: true, suspended: false,
      stripe_customer_id: null, created_at: new Date("2026-01-01"), permission,
    }));
  } } as unknown as DataSource);
  const first: Awaited<ReturnType<InfraSessionAuthorizationReader["read"]>> = await reader.read("123");
  assert.equal(first?.permissionBits, 6n); assert.equal(calls, 1);
  permissions = [null];
  const second: Awaited<ReturnType<InfraSessionAuthorizationReader["read"]>> = await reader.read("123");
  assert.equal(second?.permissionBits, 0n); assert.equal(calls, 2); assert.notEqual(first?.user, second?.user);
  permissions = ["-1"];
  await assert.rejects(reader.read("123"), RangeError);
  permissions = [];
  assert.equal(await reader.read("123"), null);
});
