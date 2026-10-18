import { createHash } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { IdempotencyAcquireResult, IdempotencyStore, IdempotencyStoredPayload } from "@nestjs/idempotency";
import { DataSource, type EntityManager } from "typeorm";

interface StoredRow { readonly fingerprint: string; readonly owner: string | null; readonly response_json: string | null; readonly expires_at: string | number; }
interface ClockRow { readonly now: string | number; }
interface ChangedRow { readonly key_hash: string; }
const DB_NOW: string = "DATEDIFF_BIG(MILLISECOND, CONVERT(datetime2, '1970-01-01'), SYSUTCDATETIME())";

@Injectable()
export class SqlServerIdempotencyStore implements IdempotencyStore, OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(SqlServerIdempotencyStore.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleaning: boolean = false;

  public constructor(private readonly dataSource: DataSource) {}

  public async acquire(key: string, owner: string, fingerprint: string, lockTtl: number): Promise<IdempotencyAcquireResult> {
    const hash: string = this.hash(key);
    return this.dataSource.transaction("SERIALIZABLE", async (manager: EntityManager): Promise<IdempotencyAcquireResult> => {
      const rows: StoredRow[] = await manager.query<StoredRow[]>(
        "SELECT fingerprint, owner, response_json, expires_at FROM idempotency_keys WITH (UPDLOCK, HOLDLOCK) WHERE key_hash = @0", [hash]);
      const clocks: ClockRow[] = await manager.query<ClockRow[]>(`SELECT ${DB_NOW} AS now`);
      const now: number = Number(clocks[0]!.now);
      const row: StoredRow | undefined = rows[0];
      if (row && Number(row.expires_at) > now) {
        return row.response_json !== null
          ? { state: "completed", fingerprint: row.fingerprint, response: JSON.parse(row.response_json) as IdempotencyStoredPayload }
          : { state: "in-flight", fingerprint: row.fingerprint };
      }
      if (row) {
        await manager.query("UPDATE idempotency_keys SET fingerprint = @1, owner = @2, response_json = NULL, expires_at = @3 WHERE key_hash = @0", [hash, fingerprint, owner, now + lockTtl]);
      } else {
        await manager.query("INSERT INTO idempotency_keys (key_hash, fingerprint, owner, response_json, expires_at) VALUES (@0, @1, @2, NULL, @3)", [hash, fingerprint, owner, now + lockTtl]);
      }
      return { state: "acquired" };
    });
  }

  public async complete(key: string, owner: string, response: IdempotencyStoredPayload, ttl: number): Promise<boolean> {
    return this.change(`UPDATE idempotency_keys SET response_json = @2, owner = NULL, expires_at = ${DB_NOW} + CAST(@3 AS bigint)
      OUTPUT inserted.key_hash WHERE key_hash = @0 AND owner = @1 AND response_json IS NULL AND expires_at > ${DB_NOW}`,
      [this.hash(key), owner, JSON.stringify(response), ttl]);
  }

  public async release(key: string, owner: string): Promise<boolean> {
    return this.change(`DELETE FROM idempotency_keys OUTPUT deleted.key_hash WHERE key_hash = @0 AND owner = @1
      AND response_json IS NULL AND expires_at > ${DB_NOW}`, [this.hash(key), owner]);
  }

  public async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    return this.change(`UPDATE idempotency_keys SET expires_at = ${DB_NOW} + CAST(@2 AS bigint)
      OUTPUT inserted.key_hash WHERE key_hash = @0 AND owner = @1 AND response_json IS NULL AND expires_at > ${DB_NOW}`, [this.hash(key), owner, lockTtl]);
  }

  public onModuleInit(): void {
    this.timer = setInterval((): void => { void this.cleanup(); }, 60_000);
    this.timer.unref();
  }

  public onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async cleanup(): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    try { await this.dataSource.query(`DELETE TOP (500) FROM idempotency_keys WHERE expires_at <= ${DB_NOW}`); }
    catch { this.logger.warn("Expired idempotency receipt cleanup failed"); }
    finally { this.cleaning = false; }
  }

  private async change(sql: string, parameters: unknown[]): Promise<boolean> {
    const rows: ChangedRow[] = await this.dataSource.query<ChangedRow[]>(sql, parameters);
    return rows.length === 1;
  }

  private hash(key: string): string { return createHash("sha256").update(key).digest("hex"); }
}
