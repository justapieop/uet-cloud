import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryFailedError, QueryResult, type DataSource, type QueryRunner } from "typeorm";
import { SqlServerIdempotencyStore } from "../dist/db/idempotency-store.js";

test("idempotency mutations read SQL Server OUTPUT records rather than the raw DELETE tuple", async (): Promise<void> => {
  let released: number = 0;
  const source: DataSource = {
    // Preserve the driver's real raw result shape so reverting to DataSource.query fails this regression.
    query: async (): Promise<unknown> => [[{ key_hash: "hash" }], 1],
    createQueryRunner: (): QueryRunner => ({
      startTransaction: async (): Promise<void> => {},
      commitTransaction: async (): Promise<void> => {},
      query: async (sql: string, parameters: unknown[], structured: boolean): Promise<QueryResult<{ key_hash: string }>> => {
        if (sql.includes("sp_getapplock")) return [{ result: 0 }] as unknown as QueryResult<{ key_hash: string }>;
        assert.equal(structured, true);
        const result: QueryResult<{ key_hash: string }> = new QueryResult<{ key_hash: string }>();
        result.records = parameters[1] === "owner" ? [{ key_hash: "hash" }] : [];
        result.affected = result.records.length;
        result.raw = sql.startsWith("DELETE") ? [result.records, result.affected] : result.records;
        return result;
      },
      release: async (): Promise<void> => { released++; },
    }) as unknown as QueryRunner,
  } as unknown as DataSource;
  const store: SqlServerIdempotencyStore = new SqlServerIdempotencyStore(source);
  assert.equal(await store.release("key", "other-owner"), false);
  assert.equal(await store.release("key", "owner"), true);
  assert.equal(await store.extend("key", "other-owner", 1000), false);
  assert.equal(await store.extend("key", "owner", 1000), true);
  assert.equal(await store.complete("key", "other-owner", { status: 202, headers: {}, body: {} }, 1000), false);
  assert.equal(await store.complete("key", "owner", { status: 202, headers: {}, body: {} }, 1000), true);
  assert.equal(released, 6);
});

test("idempotency mutation failures still release the SQL query runner", async (): Promise<void> => {
  let released: boolean = false;
  const failure: Error = new Error("Query failed");
  const source: DataSource = { createQueryRunner: (): QueryRunner => ({
    startTransaction: async (): Promise<void> => {},
    query: async (): Promise<never> => { throw failure; },
    release: async (): Promise<void> => { released = true; },
  }) as unknown as QueryRunner } as unknown as DataSource;
  await assert.rejects(new SqlServerIdempotencyStore(source).release("key", "owner"), (error: unknown): boolean => error === failure);
  assert.equal(released, true);
});

function sourceWithTransaction(
  events: string[],
  execute: (sql: string, parameters: unknown[], structured?: boolean) => Promise<unknown>,
  rollbackFailure?: Error,
): DataSource {
  return { createQueryRunner: (): QueryRunner => {
    let active: boolean = false;
    return {
      get isTransactionActive(): boolean { return active; },
      startTransaction: async (isolation: string): Promise<void> => { active = true; events.push(isolation); },
      commitTransaction: async (): Promise<void> => { active = false; events.push("commit"); },
      rollbackTransaction: async (): Promise<void> => {
        active = false; events.push("rollback");
        if (rollbackFailure) throw rollbackFailure;
      },
      release: async (): Promise<void> => { events.push("release"); },
      query: execute,
    } as unknown as QueryRunner;
  } } as unknown as DataSource;
}

test("acquire locks the hashed key before reading or inserting an absent receipt", async (): Promise<void> => {
  const events: string[] = [];
  const source: DataSource = sourceWithTransaction(events, async (sql: string, parameters: unknown[]): Promise<unknown> => {
    if (sql.includes("sp_getapplock")) {
      assert.match(String(parameters[0]), /^kumo:idempotency:[a-f0-9]{64}$/);
      assert.match(sql, /@LockOwner = 'Transaction'/);
      assert.ok(Number(parameters[1]) <= 4000);
      events.push("lock"); return [{ result: 1 }];
    }
    if (sql.startsWith("SELECT fingerprint")) {
      assert.match(sql, /CONVERT\(varchar\(64\), @0\)/);
      assert.doesNotMatch(sql, /HOLDLOCK/);
      events.push("read"); return [];
    }
    if (sql.includes(" AS now")) return [{ now: 1000 }];
    events.push("insert"); assert.equal(parameters[3], 2000); return [];
  });
  assert.deepEqual(await new SqlServerIdempotencyStore(source).acquire("key", "owner", "fingerprint", 1000), { state: "acquired" });
  assert.deepEqual(events, ["READ COMMITTED", "lock", "read", "insert", "commit", "release"]);
});

test("a failed key lock rolls back without touching the receipt", async (): Promise<void> => {
  const events: string[] = [];
  const source: DataSource = sourceWithTransaction(events, async (sql: string): Promise<unknown> => {
    assert.match(sql, /sp_getapplock/); events.push("lock"); return [{ result: -1 }];
  });
  await assert.rejects(new SqlServerIdempotencyStore(source).release("key", "owner"), /lock could not be acquired/);
  assert.deepEqual(events, ["READ COMMITTED", "lock", "rollback", "release"]);
});

[1205, 1222].forEach((code: number): void => {
  test(`SQL error ${code} ${code === 1205 ? "retries the whole rolled-back store transaction" : "is not retried"}`, async (): Promise<void> => {
    const events: string[] = [];
    let mutations: number = 0;
    const failure: QueryFailedError = new QueryFailedError("UPDATE", [], Object.assign(new Error("SQL failure"), { number: code }));
    const source: DataSource = sourceWithTransaction(events, async (sql: string): Promise<unknown> => {
      if (sql.includes("sp_getapplock")) { events.push("lock"); return [{ result: 0 }]; }
      events.push("mutate"); mutations++;
      if (mutations === 1) throw failure;
      return { records: [{ key_hash: "hash" }] };
    }, code === 1205 ? new Error("Transaction already aborted") : undefined);
    const action: Promise<boolean> = new SqlServerIdempotencyStore(source).release("key", "owner");
    if (code === 1205) {
      assert.equal(await action, true);
      assert.deepEqual(events, ["READ COMMITTED", "lock", "mutate", "rollback", "release", "READ COMMITTED", "lock", "mutate", "commit", "release"]);
    } else {
      await assert.rejects(action, (error: unknown): boolean => error === failure);
      assert.deepEqual(events, ["READ COMMITTED", "lock", "mutate", "rollback", "release"]);
    }
  });
});

test("deadlock retries stop after three attempts", async (): Promise<void> => {
  const events: string[] = [];
  const failure: QueryFailedError = new QueryFailedError("UPDATE", [], Object.assign(new Error("Deadlock"), { number: 1205 }));
  const source: DataSource = sourceWithTransaction(events, async (sql: string): Promise<unknown> => {
    if (sql.includes("sp_getapplock")) return [{ result: 0 }];
    throw failure;
  });
  await assert.rejects(new SqlServerIdempotencyStore(source).release("key", "owner"), (error: unknown): boolean => error === failure);
  assert.equal(events.filter((event: string): boolean => event === "rollback").length, 3);
  assert.equal(events.filter((event: string): boolean => event === "release").length, 3);
});
