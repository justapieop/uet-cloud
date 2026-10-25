import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DataSource, type EntityMetadata } from "typeorm";
import { InfraRole, InfraUser, InfraUserRole } from "../dist/db/index.js";

type ForeignKeyMetadata = EntityMetadata["foreignKeys"][number];
type IndexMetadata = EntityMetadata["indices"][number];

class MetadataSource extends DataSource {
  public async prepare(): Promise<void> { await this.buildMetadatas(); }
}

test("user-role entity builds valid SQL Server metadata with unique pairs and cascading references", async (): Promise<void> => {
  // Build actual ORM metadata without connecting to a database or using application credentials.
  const source: MetadataSource = new MetadataSource({ type: "mssql", entities: [InfraUser, InfraRole, InfraUserRole] });
  await source.prepare();
  const metadata: EntityMetadata = source.getMetadata(InfraUserRole);
  assert.equal(metadata.tableName, "user_roles");
  assert.deepEqual(metadata.primaryColumns.map((column): string => column.databaseName), ["id"]);
  assert.equal(metadata.primaryColumns[0]?.generationStrategy, "uuid");
  assert.equal(metadata.columns.find((column): boolean => column.databaseName === "user_id")?.isNullable, false);
  assert.equal(metadata.columns.find((column): boolean => column.databaseName === "role_id")?.isNullable, false);
  const unique: IndexMetadata | undefined = metadata.indices.find((index: IndexMetadata): boolean => index.name === "UQ_user_roles_user_role");
  assert.ok(unique?.isUnique);
  assert.deepEqual(unique.columns.map((column): string => column.databaseName), ["user_id", "role_id"]);
  assert.deepEqual(metadata.foreignKeys.map((key: ForeignKeyMetadata): { table: string; columns: string[]; referenced: string[]; onDelete: string | undefined } => ({
    table: key.referencedEntityMetadata.tableName, columns: key.columns.map((column): string => column.databaseName),
    referenced: key.referencedColumns.map((column): string => column.databaseName), onDelete: key.onDelete,
  })), [
    { table: "users", columns: ["user_id"], referenced: ["id"], onDelete: "CASCADE" },
    { table: "roles", columns: ["role_id"], referenced: ["id"], onDelete: "CASCADE" },
  ]);
});
