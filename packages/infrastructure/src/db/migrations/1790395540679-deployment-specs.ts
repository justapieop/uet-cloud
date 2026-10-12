import {
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from "typeorm";
import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeploymentSpecs1790395540679 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const specsTableExists: boolean = await queryRunner.hasTable("deployment_specs");
    if (!specsTableExists) {
      await queryRunner.createTable(
        new Table({
          name: "deployment_specs",
          columns: [
            {
              name: "id",
              type: "nvarchar",
              length: "255",
              isPrimary: true,
              isNullable: false,
            },
            {
              name: "deployment_id",
              type: "nvarchar",
              length: "255",
              isNullable: false,
              isUnique: true,
            },
            {
              name: "image",
              type: "nvarchar",
              length: "1024",
              isNullable: false,
            },
            {
              name: "target_port",
              type: "int",
              isNullable: false,
            },
            {
              name: "cpu",
              type: "float",
              isNullable: false,
              default: 0.25,
            },
            {
              name: "memory",
              type: "float",
              isNullable: false,
              default: 0.5,
            },
            {
              name: "min_replicas",
              type: "int",
              isNullable: false,
              default: 0,
            },
            {
              name: "max_replicas",
              type: "int",
              isNullable: false,
              default: 2,
            },
            {
              name: "env_vars",
              type: "nvarchar",
              length: "MAX",
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
          foreignKeys: [
            new TableForeignKey({
              name: "FK_deployment_specs_deployment_id",
              columnNames: ["deployment_id"],
              referencedTableName: "deployments",
              referencedColumnNames: ["id"],
              onDelete: "CASCADE",
              onUpdate: "CASCADE",
            }),
          ],
        }),
        true,
      );

      await queryRunner.createIndex(
        "deployment_specs",
        new TableIndex({
          name: "IDX_deployment_specs_deployment_id",
          columnNames: ["deployment_id"],
          isUnique: true,
        }),
      );
    }

    const hasSpecColumn: boolean = await queryRunner.hasColumn("deployments", "spec");
    if (hasSpecColumn) {
      const rows: Array<{
        id: string;
        spec: string;
        created_at: Date;
        updated_at: Date;
      }> = await queryRunner.query(
        "SELECT id, spec, created_at, updated_at FROM deployments",
      );

      for (const row of rows) {
        if (row.spec) {
          try {
            const parsedSpec: {
              image?: string;
              targetPort?: number;
              resources?: { cpu?: number; memory?: number };
              scaling?: { minReplicas?: number; maxReplicas?: number };
              envVars?: Record<string, string> | null;
            } = JSON.parse(row.spec);

            const specId: string = `${row.id}-spec`;
            const image: string = parsedSpec.image ?? "unknown";
            const targetPort: number = parsedSpec.targetPort ?? 80;
            const cpu: number = parsedSpec.resources?.cpu ?? 0.25;
            const memory: number = parsedSpec.resources?.memory ?? 0.5;
            const minReplicas: number = parsedSpec.scaling?.minReplicas ?? 0;
            const maxReplicas: number = parsedSpec.scaling?.maxReplicas ?? 2;
            const envVars: string | null = parsedSpec.envVars
              ? JSON.stringify(parsedSpec.envVars)
              : null;

            await queryRunner.query(
              `INSERT INTO deployment_specs (id, deployment_id, image, target_port, cpu, memory, min_replicas, max_replicas, env_vars, created_at, updated_at)
               VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, @9, @10)`,
              [
                specId,
                row.id,
                image,
                targetPort,
                cpu,
                memory,
                minReplicas,
                maxReplicas,
                envVars,
                row.created_at,
                row.updated_at,
              ],
            );
          } catch {
            // Ignore JSON parse errors for corrupt legacy entries
          }
        }
      }

      await queryRunner.dropColumn("deployments", "spec");
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasSpecColumn: boolean = await queryRunner.hasColumn("deployments", "spec");
    if (!hasSpecColumn) {
      await queryRunner.addColumn(
        "deployments",
        new TableColumn({
          name: "spec",
          type: "nvarchar",
          length: "MAX",
          isNullable: true,
        }),
      );

      const rows: Array<{
        deployment_id: string;
        image: string;
        target_port: number;
        cpu: number;
        memory: number;
        min_replicas: number;
        max_replicas: number;
        env_vars: string | null;
      }> = await queryRunner.query(
        "SELECT deployment_id, image, target_port, cpu, memory, min_replicas, max_replicas, env_vars FROM deployment_specs",
      );

      for (const row of rows) {
        const specObj: {
          image: string;
          targetPort: number;
          resources: { cpu: number; memory: number };
          scaling: { minReplicas: number; maxReplicas: number };
          envVars: Record<string, string> | null;
        } = {
          image: row.image,
          targetPort: row.target_port,
          resources: { cpu: row.cpu, memory: row.memory },
          scaling: { minReplicas: row.min_replicas, maxReplicas: row.max_replicas },
          envVars: row.env_vars ? (JSON.parse(row.env_vars) as Record<string, string>) : null,
        };

        await queryRunner.query(
          "UPDATE deployments SET spec = @0 WHERE id = @1",
          [JSON.stringify(specObj), row.deployment_id],
        );
      }
    }

    await queryRunner.dropTable("deployment_specs", true);
  }
}
