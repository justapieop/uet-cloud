import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryRunner, TableIndex } from "typeorm";
import { PlanStripeProduct1792540800001 } from "../dist/db/migrations.js";

test("plan product migration maintains index metadata when creating and rolling back the column", async (): Promise<void> => {
  let databaseIndexExists: boolean = false;
  let cachedIndexExists: boolean = false;
  const runner: Pick<QueryRunner, "addColumn" | "createIndex" | "createCheckConstraint" | "dropCheckConstraint" | "dropColumn" | "dropIndex" | "query"> = {
    addColumn: async (): Promise<void> => {},
    createCheckConstraint: async (): Promise<void> => {},
    dropCheckConstraint: async (): Promise<void> => {},
    createIndex: async (_table, index: TableIndex): Promise<void> => {
      assert.equal(index.name, "UQ_plans_stripe_product_id");
      assert.equal(index.isUnique, true);
      assert.deepEqual(index.columnNames, ["stripe_product_id"]);
      assert.equal(index.where, "stripe_product_id IS NOT NULL");
      databaseIndexExists = true;
      cachedIndexExists = true;
    },
    dropIndex: async (_table, index): Promise<void> => {
      assert.equal(index, "UQ_plans_stripe_product_id");
      assert.equal(databaseIndexExists, true);
      databaseIndexExists = false;
      cachedIndexExists = false;
    },
    dropColumn: async (_table, column): Promise<void> => {
      if (column === "stripe_product_id" && cachedIndexExists) {
        assert.equal(databaseIndexExists, true, "Stale schema metadata would drop an already removed index");
        databaseIndexExists = false;
        cachedIndexExists = false;
      }
    },
    // Model raw DDL: the index changes in SQL Server but the QueryRunner cache stays stale.
    query: (async (sql: string): Promise<unknown[]> => {
      if (sql.startsWith("CREATE UNIQUE INDEX")) databaseIndexExists = true;
      if (sql.startsWith("DROP INDEX")) databaseIndexExists = false;
      return [];
    }) as QueryRunner["query"],
  };
  const migration: PlanStripeProduct1792540800001 = new PlanStripeProduct1792540800001();
  await migration.up(runner as QueryRunner);
  assert.equal(databaseIndexExists, true);
  // A rollback starts with SQL Server's current schema loaded into the runner.
  cachedIndexExists = databaseIndexExists;
  await migration.down(runner as QueryRunner);
  assert.equal(databaseIndexExists, false);
  assert.equal(cachedIndexExists, false);
});
