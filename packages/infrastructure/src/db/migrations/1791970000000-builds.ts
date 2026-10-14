import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

export class Builds1791970000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({ name: "builds", columns: [
      { name: "id", type: "nvarchar", length: "36", isPrimary: true },
      { name: "user_id", type: "nvarchar", length: "255" },
      { name: "repo", type: "nvarchar", length: "2048" },
      { name: "commit_sha", type: "nvarchar", length: "40" },
      { name: "dockerfile_path", type: "nvarchar", length: "1024" },
      { name: "image", type: "nvarchar", length: "1024" },
      { name: "status", type: "nvarchar", length: "32" },
      { name: "source_token_hash", type: "nvarchar", length: "64" },
      { name: "source_expires_at", type: "datetime2" },
      { name: "run_id", type: "nvarchar", length: "32", isNullable: true },
      { name: "run_url", type: "nvarchar", length: "2048", isNullable: true },
      { name: "created_at", type: "datetime2" },
      { name: "updated_at", type: "datetime2" },
    ] }), true);
    await queryRunner.createIndex("builds", new TableIndex({ name: "IDX_builds_user_id", columnNames: ["user_id"] }));
  }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.dropTable("builds"); }
}
