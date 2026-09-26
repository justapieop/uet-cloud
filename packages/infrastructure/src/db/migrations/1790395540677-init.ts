import { Table } from "typeorm";
import type { MigrationInterface, QueryRunner } from "typeorm";

export class Init1790395540677 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "users",
                columns: [
                    {
                        name: "id",
                        type: "nvarchar",
                        length: "255",
                        isPrimary: true,
                        isNullable: false,
                    },
                    {
                        name: "display_name",
                        type: "nvarchar",
                        length: "255",
                        isNullable: false,
                    },
                    {
                        name: "email",
                        type: "nvarchar",
                        length: "255",
                        isNullable: false,
                    },
                    {
                        name: "created_at",
                        type: "datetime2",
                        precision: 7,
                        isNullable: false,
                        default: "GETDATE()",
                    },
                    {
                        name: "suspended",
                        type: "bit",
                        isNullable: false,
                        default: 0,
                    },
                ],
            }),
            true,
        );

        await queryRunner.createTable(
            new Table({
                name: "roles",
                columns: [
                    {
                        name: "id",
                        type: "nvarchar",
                        length: "255",
                        isPrimary: true,
                        isNullable: false,
                    },
                    {
                        name: "name",
                        type: "nvarchar",
                        length: "255",
                        isNullable: false,
                    },
                    {
                        name: "created_at",
                        type: "datetime2",
                        precision: 7,
                        isNullable: false,
                        default: "GETDATE()",
                    },
                    {
                        name: "permission",
                        type: "bigint",
                        isNullable: false,
                        default: 0,
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("roles", true);
        await queryRunner.dropTable("users", true);
    }
}
