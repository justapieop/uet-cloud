import type { EntityManager } from "typeorm";

export async function acquireBootstrapLock(manager: EntityManager): Promise<void> {
  const locks: { result: number }[] = await manager.query(`
    DECLARE @result int;
    EXEC @result = sys.sp_getapplock @Resource = N'kumo:database-seed',
      @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
    SELECT @result AS result;
  `);
  if (!locks.length || locks[0]!.result < 0) throw new Error("Unable to acquire the database bootstrap lock");
}
