import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryResult, type DataSource, type QueryRunner } from "typeorm";
import { SqlServerIdempotencyStore } from "../dist/db/idempotency-store.js";

test("idempotency mutations read SQL Server OUTPUT records rather than the raw DELETE tuple", async (): Promise<void> => {
  let released: number = 0;
  const source: DataSource = {
    // Preserve the driver's real raw result shape so reverting to DataSource.query fails this regression.
    query: async (): Promise<unknown> => [[{ key_hash: "hash" }], 1],
    createQueryRunner: (): QueryRunner => ({
      query: async (sql: string, parameters: unknown[], structured: boolean): Promise<QueryResult<{ key_hash: string }>> => {
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
    query: async (): Promise<never> => { throw failure; },
    release: async (): Promise<void> => { released = true; },
  }) as unknown as QueryRunner } as unknown as DataSource;
  await assert.rejects(new SqlServerIdempotencyStore(source).release("key", "owner"), (error: unknown): boolean => error === failure);
  assert.equal(released, true);
});
