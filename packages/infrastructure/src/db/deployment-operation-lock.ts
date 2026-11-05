import type {
  DeploymentOperation,
  DeploymentOperationLease,
  DeploymentOperationLock,
} from "@kumo/application";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";

interface DeploymentOperationLockRow {
  readonly deploymentId: string;
  readonly operation: DeploymentOperation;
  readonly token: string;
}

@Injectable()
export class InfraDeploymentOperationLock implements DeploymentOperationLock {
  public constructor(
    private readonly dataSource: DataSource,
    public readonly leaseDurationMs: number = 120_000,
  ) {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 3_000 || leaseDurationMs > 2_147_483_647) {
      throw new Error("Deployment operation lock lease duration must be an integer from 3000 to 2147483647 milliseconds");
    }
  }

  public async acquire(deploymentId: string, operation: DeploymentOperation): Promise<DeploymentOperationLease | null> {
    const token: string = randomUUID();
    return this.dataSource.transaction("SERIALIZABLE", async (manager: EntityManager): Promise<DeploymentOperationLease | null> => {
      const rows: DeploymentOperationLockRow[] = await manager.query(
        "SELECT deployment_id AS deploymentId, operation, lease_token AS token FROM deployment_operation_locks WITH (UPDLOCK, HOLDLOCK) WHERE deployment_id = @0",
        [deploymentId],
      ) as DeploymentOperationLockRow[];
      if (rows.length > 0) {
        const claimed: DeploymentOperationLockRow[] = await manager.query(
          "UPDATE deployment_operation_locks SET operation = @1, lease_token = @2, expires_at = DATEADD(MILLISECOND, @3, SYSUTCDATETIME()) OUTPUT inserted.deployment_id AS deploymentId, inserted.operation, inserted.lease_token AS token WHERE deployment_id = @0 AND expires_at <= SYSUTCDATETIME()",
          [deploymentId, operation, token, this.leaseDurationMs],
        ) as DeploymentOperationLockRow[];
        if (claimed.length === 0) return null;
      } else {
        await manager.query(
          "INSERT INTO deployment_operation_locks (deployment_id, operation, lease_token, expires_at) VALUES (@0, @1, @2, DATEADD(MILLISECOND, @3, SYSUTCDATETIME()))",
          [deploymentId, operation, token, this.leaseDurationMs],
        );
      }

      return { deploymentId, operation, token };
    });
  }

  public async renew(lease: DeploymentOperationLease): Promise<boolean> {
    const rows: DeploymentOperationLockRow[] = await this.dataSource.query(
      "UPDATE deployment_operation_locks SET expires_at = DATEADD(MILLISECOND, @2, SYSUTCDATETIME()) OUTPUT inserted.deployment_id AS deploymentId, inserted.operation, inserted.lease_token AS token WHERE deployment_id = @0 AND lease_token = @1 AND expires_at > SYSUTCDATETIME()",
      [lease.deploymentId, lease.token, this.leaseDurationMs],
    ) as DeploymentOperationLockRow[];
    return rows.length === 1;
  }

  public async release(lease: DeploymentOperationLease): Promise<void> {
    await this.dataSource.query(
      "DELETE FROM deployment_operation_locks WHERE deployment_id = @0 AND lease_token = @1",
      [lease.deploymentId, lease.token],
    );
  }
}
