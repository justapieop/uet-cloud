import { User } from "@kumo/domain";
import type { SessionAuthorizationReader } from "@kumo/application";
import type { DataSource } from "typeorm";

interface AuthorizationRow {
  readonly id: string;
  readonly display_name: string;
  readonly active: boolean;
  readonly suspended: boolean;
  readonly stripe_customer_id: string | null;
  readonly created_at: Date;
  readonly permission: string | bigint | null;
}

export class InfraSessionAuthorizationReader implements SessionAuthorizationReader {
  public constructor(private readonly source: DataSource) {}
  public async read(userId: string): ReturnType<SessionAuthorizationReader["read"]> {
    const rows: AuthorizationRow[] = await this.source.query(`
      SELECT u.id, u.display_name, u.active, u.suspended, u.stripe_customer_id, u.created_at, r.permission
      FROM users u LEFT JOIN user_roles assignment ON assignment.user_id = u.id
      LEFT JOIN roles r ON r.id = assignment.role_id AND r.active = 1 WHERE u.id = @0
    `, [userId]);
    const first: AuthorizationRow | undefined = rows[0];
    if (!first) return null;
    let permissionBits: bigint = 0n;
    for (let index: number = 0; index < rows.length; index++) {
      const bits: bigint = BigInt(rows[index]!.permission ?? 0);
      if (bits < 0n || bits > (1n << 63n) - 1n) throw new RangeError("Stored role permissions are invalid");
      permissionBits |= bits;
    }
    return { user: new User({ id: first.id, displayName: first.display_name, active: first.active,
      suspended: first.suspended, stripeCustomerId: first.stripe_customer_id, createdAt: first.created_at,
    }), permissionBits };
  }
}
