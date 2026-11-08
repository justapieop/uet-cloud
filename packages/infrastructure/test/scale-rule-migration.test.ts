import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DataSource, type QueryRunner } from "typeorm";
import { DATABASE_MIGRATIONS, DeploymentResourceUpdates1794096000000, ScaleRules1794009600000 } from "../dist/db/migrations.js";

test("scale rule migration emits SQL Server DDL with ownership linkage, constraints, and due index without changing deployments", async (): Promise<void> => {
  const source: DataSource = new DataSource({ type: "mssql", database: "ddl_only" });
  const runner: QueryRunner = source.createQueryRunner();
  runner.enableSqlMemory();
  try {
    await new ScaleRules1794009600000().up(runner);
    const ddl: string = runner.getMemorySql().upQueries.map((query): string => query.query).join("\n");
    assert.match(ddl, /CREATE TABLE "scale_rules"/);
    assert.match(ddl, /FOREIGN KEY \("deployment_id"\) REFERENCES "deployments" \("id"\) ON DELETE CASCADE/);
    assert.match(ddl, /CHECK \(min_replicas >= 1 AND max_replicas >= min_replicas AND max_replicas <= 1000\)/);
    assert.match(ddl, /CREATE INDEX "IDX_scale_rules_due"/);
    assert.match(ddl, /"next_evaluation_at" datetime2\(7\) NOT NULL.*SYSUTCDATETIME\(\)/);
    assert.doesNotMatch(ddl, /(?:DROP|ALTER) TABLE "deployments"/);
    assert.deepEqual(DATABASE_MIGRATIONS.slice(-2), [ScaleRules1794009600000, DeploymentResourceUpdates1794096000000]);
  } finally { await runner.release(); }
});
