import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { RootLoginThrottled, type RootPasswordVerifier } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject): void => {
    scrypt(password, salt, 32, { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 }, (error: Error | null, result: Buffer): void => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

export class RootPasswordAuthentication implements RootPasswordVerifier {
  public readonly enabled: boolean;

  private constructor(private readonly source: Pick<DataSource, "query">, private readonly salt: Buffer, private readonly expected: Buffer | null) {
    this.enabled = expected !== null;
  }

  public static async create(config: ConfigService, source: Pick<DataSource, "query">): Promise<RootPasswordAuthentication> {
    const password: string | undefined = config.get<string>("ROOT_PASSWORD");
    const salt: Buffer = randomBytes(32);
    if (!password) return new RootPasswordAuthentication(source, salt, null);
    if (password.length < 16 || password.length > 1024 || !password.trim()) {
      throw new Error("ROOT_PASSWORD must contain 16–1024 characters");
    }
    return new RootPasswordAuthentication(source, salt, await derive(password, salt));
  }

  public async verify(password: string): Promise<boolean> {
    if (!this.expected) return false;
    // One atomic database counter is shared by every API replica. Count every
    // attempt, including valid passwords, before performing the expensive hash.
    const attempts: { readonly attempts: number }[] = await this.source.query(`
      UPDATE root_login_limits SET
        attempts = CASE WHEN window_started <= DATEADD(SECOND, -60, SYSUTCDATETIME()) THEN 1 ELSE attempts + 1 END,
        window_started = CASE WHEN window_started <= DATEADD(SECOND, -60, SYSUTCDATETIME()) THEN SYSUTCDATETIME() ELSE window_started END
      OUTPUT inserted.attempts
      WHERE id = 1 AND (attempts < 5 OR window_started <= DATEADD(SECOND, -60, SYSUTCDATETIME()));`);
    if (attempts.length !== 1) throw new RootLoginThrottled();
    return timingSafeEqual(await derive(password, this.salt), this.expected);
  }
}
