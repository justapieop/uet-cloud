import { Table, TableCheck, TableColumn, TableForeignKey, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

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

      for (let index: number = 0; index < rows.length; index++) {
        const row: (typeof rows)[number] = rows[index];
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

      for (let index: number = 0; index < rows.length; index++) {
        const row: (typeof rows)[number] = rows[index];
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

export class AsyncBuilds1791975000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn("builds", "commit_sha", new TableColumn({ name: "commit_sha", type: "nvarchar", length: "40", isNullable: true }));
    await queryRunner.addColumns("builds", [
      new TableColumn({ name: "ref", type: "nvarchar", length: "255", isNullable: true }),
      new TableColumn({ name: "error", type: "nvarchar", length: "2048", isNullable: true }),
    ]);
    await queryRunner.createIndex("builds", new TableIndex({ name: "IDX_builds_status_created_at", columnNames: ["status", "created_at"] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn("builds", "commit_sha", new TableColumn({ name: "commit_sha", type: "nvarchar", length: "40", isNullable: false }));
    await queryRunner.dropIndex("builds", "IDX_builds_status_created_at");
    await queryRunner.dropColumn("builds", "error");
    await queryRunner.dropColumn("builds", "ref");
  }
}

export class DeploymentWorkflow1792108800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("deployments", [
      new TableColumn({ name: "creation_request", type: "nvarchar", length: "MAX", isNullable: true }),
      new TableColumn({ name: "image", type: "nvarchar", length: "1024", isNullable: true }),
      new TableColumn({ name: "build_id", type: "nvarchar", length: "36", isNullable: true }),
      new TableColumn({ name: "azure_resource_id", type: "nvarchar", length: "2048", isNullable: true }),
    ]);
    await queryRunner.createIndex("deployments", new TableIndex({ name: "UQ_deployments_user_name", columnNames: ["user_id", "name"], isUnique: true }));
    await queryRunner.createIndex("deployments", new TableIndex({ name: "IDX_deployments_queue", columnNames: ["status", "updated_at"] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("deployments", "IDX_deployments_queue");
    await queryRunner.dropIndex("deployments", "UQ_deployments_user_name");
    await queryRunner.dropColumn("deployments", "azure_resource_id");
    await queryRunner.dropColumn("deployments", "build_id");
    await queryRunner.dropColumn("deployments", "image");
    await queryRunner.dropColumn("deployments", "creation_request");
  }
}

export class RemoveUnusedDeploymentSpecs1792108800001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("deployment_specs", true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback restores the legacy schema; dropped rows cannot be recovered.
    await queryRunner.createTable(new Table({
      name: "deployment_specs",
      columns: [
        { name: "id", type: "nvarchar", length: "255", isPrimary: true },
        { name: "deployment_id", type: "nvarchar", length: "255", isUnique: true },
        { name: "image", type: "nvarchar", length: "1024" },
        { name: "target_port", type: "int" },
        { name: "cpu", type: "float", default: 0.25 },
        { name: "memory", type: "float", default: 0.5 },
        { name: "min_replicas", type: "int", default: 0 },
        { name: "max_replicas", type: "int", default: 2 },
        { name: "env_vars", type: "nvarchar", length: "MAX", isNullable: true },
        { name: "created_at", type: "datetime2", precision: 7, default: "GETDATE()" },
        { name: "updated_at", type: "datetime2", precision: 7, default: "GETDATE()" },
      ],
      foreignKeys: [new TableForeignKey({
        name: "FK_deployment_specs_deployment_id",
        columnNames: ["deployment_id"],
        referencedTableName: "deployments",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      })],
    }));
    await queryRunner.createIndex("deployment_specs", new TableIndex({
      name: "IDX_deployment_specs_deployment_id", columnNames: ["deployment_id"], isUnique: true,
    }));
  }
}

export class Plans1792108800002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: "plans",
      columns: [
        { name: "id", type: "nvarchar", length: "255", isPrimary: true },
        { name: "name", type: "nvarchar", length: "255" },
        { name: "price", type: "decimal", precision: 19, scale: 4 },
        { name: "vcpu", type: "float" },
        { name: "memory", type: "float" },
        { name: "deployments", type: "int" },
        { name: "disk", type: "int" },
      ],
      checks: [
        new TableCheck({ name: "CK_plans_price", expression: "price >= 0" }),
        new TableCheck({ name: "CK_plans_vcpu", expression: "vcpu > 0" }),
        new TableCheck({ name: "CK_plans_memory", expression: "memory > 0 AND memory = vcpu * 2" }),
        new TableCheck({ name: "CK_plans_deployments", expression: "deployments > 0" }),
        new TableCheck({ name: "CK_plans_disk", expression: "disk > 0" }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("plans");
  }
}

export class PlanActive1792108800003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("plans", new TableColumn({
      name: "active", type: "bit", isNullable: false, default: 1,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("plans", "active");
  }
}

export const DATABASE_MIGRATIONS: Array<new () => MigrationInterface> = [
  Init1790395540677,
  Deployments1790395540678,
  DeploymentSpecs1790395540679,
  Builds1791970000000,
  AsyncBuilds1791975000000,
  DeploymentWorkflow1792108800000,
  RemoveUnusedDeploymentSpecs1792108800001,
  Plans1792108800002,
  PlanActive1792108800003,
];

