import { DeploymentRequestInProgress, type DeploymentRequestReceipt, type DeploymentRequestRepository } from "@kumo/application";
import type { DeploymentDetails } from "@kumo/domain";
import type { EntityManager } from "typeorm";

interface ReceiptRow { readonly fingerprint: string; readonly deployment_json: string; }
interface LockRow { readonly result: number; }

export class InfraDeploymentRequestRepository implements DeploymentRequestRepository {
  public constructor(private readonly manager: EntityManager) {}

  public async findForUpdate(keyHash: string): Promise<DeploymentRequestReceipt | null> {
    const locks: LockRow[] = await this.manager.query<LockRow[]>(`
      DECLARE @result int;
      EXEC @result = sys.sp_getapplock @Resource = @0, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 0;
      SELECT @result AS result;`, [`kumo:deployment-request:${keyHash}`]);
    if (!locks[0] || locks[0].result < 0) throw new DeploymentRequestInProgress("This deployment request is already being processed");
    const rows: ReceiptRow[] = await this.manager.query<ReceiptRow[]>(
      "SELECT fingerprint, deployment_json FROM deployment_request_receipts WHERE key_hash = @0", [keyHash]);
    const row: ReceiptRow | undefined = rows[0];
    if (!row) return null;
    const details: DeploymentDetails = JSON.parse(row.deployment_json) as DeploymentDetails;
    return { fingerprint: row.fingerprint, deployment: {
      ...details, createdAt: details.createdAt ? new Date(details.createdAt) : undefined,
      updatedAt: details.updatedAt ? new Date(details.updatedAt) : undefined,
    } };
  }

  public async save(keyHash: string, receipt: DeploymentRequestReceipt): Promise<void> {
    await this.manager.query(
      "INSERT INTO deployment_request_receipts (key_hash, fingerprint, deployment_json) VALUES (@0, @1, @2)",
      [keyHash, receipt.fingerprint, JSON.stringify(receipt.deployment)]);
  }
}
