import { Table, TableIndex } from "typeorm";
import type { MigrationInterface, QueryRunner } from "typeorm";

export class Deployments1790395540678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "deployments",
        columns: [
          {
            name: "id",
            type: "nvarchar",
            length: "255",
            isPrimary: true,
            isNullable: false,
          },
          {
            name: "user_id",
            type: "nvarchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "name",
            type: "nvarchar",
            length: "32",
            isNullable: false,
          },
          {
            name: "status",
            type: "nvarchar",
            length: "32",
            isNullable: false,
          },
          {
            name: "spec",
            type: "nvarchar",
            length: "MAX",
            isNullable: false,
          },
          {
            name: "fqdn",
            type: "nvarchar",
            length: "2048",
            isNullable: true,
          },
          {
            name: "error_message",
            type: "nvarchar",
            length: "1000",
            isNullable: true,
          },
          {
            name: "created_at",
            type: "datetime2",
            precision: 7,
            isNullable: false,
            default: "GETDATE()",
          },
          {
            name: "updated_at",
            type: "datetime2",
            precision: 7,
            isNullable: false,
            default: "GETDATE()",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "deployments",
      new TableIndex({
        name: "IDX_deployments_user_id",
        columnNames: ["user_id"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("deployments", true);
  }
}
