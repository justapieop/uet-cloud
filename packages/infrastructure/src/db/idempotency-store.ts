import { createHash } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { IdempotencyAcquireResult, IdempotencyStore, IdempotencyStoredPayload } from "@nestjs/idempotency";
import { DataSource, QueryFailedError, type QueryResult, type QueryRunner } from "typeorm";

interface StoredRow { readonly fingerprint: string; readonly owner: string | null; readonly response_json: string | null; readonly expires_at: string | number; }
interface ClockRow { readonly now: string | number; }
interface ChangedRow { readonly key_hash: string; }
interface LockRow { readonly result: number; }
const DB_NOW: string = "DATEDIFF_BIG(MILLISECOND, CONVERT(datetime2, '1970-01-01'), SYSUTCDATETIME())";

@Injectable()
export class SqlServerIdempotencyStore implements IdempotencyStore, OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(SqlServerIdempotencyStore.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleaning: boolean = false;

  public constructor(private readonly dataSource: DataSource) {}

  public async acquire(key: string, owner: string, fingerprint: string, lockTtl: number): Promise<IdempotencyAcquireResult> {
    const hash: string = this.hash(key);
    return this.withKey(hash, async (manager: QueryRunner): Promise<IdempotencyAcquireResult> => {
      const rows: StoredRow[] = await manager.query(
        "SELECT fingerprint, owner, response_json, expires_at FROM idempotency_keys WITH (UPDLOCK, ROWLOCK) WHERE key_hash = CONVERT(varchar(64), @0)", [hash]);
      const clocks: ClockRow[] = await manager.query(`SELECT ${DB_NOW} AS now`);
      const now: number = Number(clocks[0]!.now);
      const row: StoredRow | undefined = rows[0];
      if (row && Number(row.expires_at) > now) {
        return row.response_json !== null
          ? { state: "completed", fingerprint: row.fingerprint, response: JSON.parse(row.response_json) as IdempotencyStoredPayload }
          : { state: "in-flight", fingerprint: row.fingerprint };
      }
      if (row) {
        await manager.query("UPDATE idempotency_keys SET fingerprint = @1, owner = @2, response_json = NULL, expires_at = @3 WHERE key_hash = CONVERT(varchar(64), @0)", [hash, fingerprint, owner, now + lockTtl]);
      } else {
        await manager.query("INSERT INTO idempotency_keys (key_hash, fingerprint, owner, response_json, expires_at) VALUES (@0, @1, @2, NULL, @3)", [hash, fingerprint, owner, now + lockTtl]);
      }
      return { state: "acquired" };
    });
  }

  public async complete(key: string, owner: string, response: IdempotencyStoredPayload, ttl: number): Promise<boolean> {
    return this.change(`UPDATE idempotency_keys SET response_json = @2, owner = NULL, expires_at = ${DB_NOW} + CAST(@3 AS bigint)
      OUTPUT inserted.key_hash WHERE key_hash = CONVERT(varchar(64), @0) AND owner = @1 AND response_json IS NULL AND expires_at > ${DB_NOW}`,
      [this.hash(key), owner, JSON.stringify(response), ttl]);
  }

  public async release(key: string, owner: string): Promise<boolean> {
    return this.change(`DELETE FROM idempotency_keys OUTPUT deleted.key_hash WHERE key_hash = CONVERT(varchar(64), @0) AND owner = @1
      AND response_json IS NULL AND expires_at > ${DB_NOW}`, [this.hash(key), owner]);
  }

  public async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    return this.change(`UPDATE idempotency_keys SET expires_at = ${DB_NOW} + CAST(@2 AS bigint)
      OUTPUT inserted.key_hash WHERE key_hash = CONVERT(varchar(64), @0) AND owner = @1 AND response_json IS NULL AND expires_at > ${DB_NOW}`, [this.hash(key), owner, lockTtl]);
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
    return this.withKey(parameters[0] as string, async (runner: QueryRunner): Promise<boolean> => {
      // SQL Server's raw DELETE result is [recordset, affectedRows], unlike UPDATE.
      // The structured result exposes OUTPUT records consistently for both.
      const result: QueryResult<ChangedRow> = await runner.query(sql, parameters, true);
      return result.records.length === 1;
    });
  }

  private async withKey<T>(hash: string, operation: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const deadline: number = Date.now() + 4_000;
    for (let attempt: number = 0; ; attempt++) {
      const runner: QueryRunner = this.dataSource.createQueryRunner();
      let retry: boolean = false;
      try {
        await runner.startTransaction("READ COMMITTED");
        // Serialize absent keys as well as existing rows, across API replicas.
        // Every owner mutation must take this lock before touching the row.
        const locks: LockRow[] = await runner.query(`DECLARE @result int;
          EXEC @result = sys.sp_getapplock @Resource = @0, @LockMode = 'Exclusive',
            @LockOwner = 'Transaction', @LockTimeout = @1;
          SELECT @result AS result;`, [`kumo:idempotency:${hash}`, Math.max(0, deadline - Date.now())]);
        if (!locks[0] || locks[0].result < 0) throw new Error("Idempotency key lock could not be acquired");
        const result: T = await operation(runner);
        await runner.commitTransaction();
        return result;
      } catch (error: unknown) {
        if (runner.isTransactionActive) {
          try { await runner.rollbackTransaction(); }
          // The driver may already have aborted a deadlock victim. Preserve
          // the original SQL error, as TypeORM's transaction helper does.
          catch { /* Original failure is handled below. */ }
        }
        // SQL Server rolls back deadlock victims. Retry only that known outcome,
        // never a timeout or an uncertain commit, and never business/cloud work.
        retry = error instanceof QueryFailedError && error.driverError.number === 1205
          && attempt < 2 && Date.now() + 50 < deadline;
        if (!retry) throw error;
      } finally { await runner.release(); }
      if (retry) await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 10 + Math.floor(Math.random() * 40)); });
    }
  }

  private hash(key: string): string { return createHash("sha256").update(key).digest("hex"); }
}
