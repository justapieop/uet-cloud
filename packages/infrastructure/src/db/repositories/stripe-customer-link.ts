import { randomUUID } from "node:crypto";
import { StripeCustomerLinkInProgress, StripeCustomerLinkReconciliationRequired, type StripeCustomerLinkClaim, type StripeCustomerLinkRepository } from "@kumo/application";
import { User } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { InfraUser } from "./user.js";

interface LinkRow {
  readonly operation_id: string;
  readonly first_attempt_at: Date;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
}
interface ClockRow { readonly now: Date; }

// Stop well before Stripe may prune a key after 24 hours. Never rotate an uncertain key.
const REPLAY_WINDOW_MS: number = 23 * 60 * 60 * 1000;

@Injectable()
export class InfraStripeCustomerLinkRepository implements StripeCustomerLinkRepository {
  public constructor(private readonly dataSource: DataSource) {}

  public claim(userId: string, owner: string): Promise<StripeCustomerLinkClaim> {
    return this.dataSource.transaction(async (manager: EntityManager): Promise<StripeCustomerLinkClaim> => {
      const user: User = await this.lockUser(manager, userId);
      if (user.stripeCustomerId || user.suspended) return { state: "linked", user };
      const rows: LinkRow[] = await manager.query("SELECT operation_id, first_attempt_at, lease_owner, lease_expires_at FROM stripe_customer_links WHERE user_id = @0", [userId]);
      const clocks: ClockRow[] = await manager.query("SELECT SYSUTCDATETIME() AS now");
      const now: number = new Date(clocks[0]!.now).getTime();
      const row: LinkRow | undefined = rows[0];
      if (row && now - new Date(row.first_attempt_at).getTime() >= REPLAY_WINDOW_MS) {
        throw new StripeCustomerLinkReconciliationRequired("An earlier Stripe customer creation needs reconciliation before login can retry");
      }
      if (row?.lease_owner && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > now) {
        return { state: "busy" };
      }
      const operationId: string = (row?.operation_id ?? randomUUID()).toLowerCase();
      if (row) {
        await manager.query("UPDATE stripe_customer_links SET lease_owner = @1, lease_expires_at = DATEADD(SECOND, 120, SYSUTCDATETIME()) WHERE user_id = @0", [userId, owner]);
      } else {
        await manager.query("INSERT INTO stripe_customer_links (user_id, operation_id, lease_owner, lease_expires_at) VALUES (@0, @1, @2, DATEADD(SECOND, 120, SYSUTCDATETIME()))", [userId, operationId, owner]);
      }
      return { state: "create", idempotencyKey: `kumo:stripe:customer:${operationId}` };
    });
  }

  public complete(userId: string, owner: string, customerId: string): Promise<User> {
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId) || customerId.length > 255) throw new Error("Stripe returned an invalid customer ID");
    return this.dataSource.transaction(async (manager: EntityManager): Promise<User> => {
      const user: User = await this.lockUser(manager, userId);
      if (user.stripeCustomerId === customerId) return user;
      if (user.stripeCustomerId) throw new Error("User already has a different Stripe customer; refusing to replace the link");
      const rows: LinkRow[] = await manager.query("SELECT operation_id, first_attempt_at, lease_owner, lease_expires_at FROM stripe_customer_links WHERE user_id = @0", [userId]);
      if (rows[0]?.lease_owner?.toLowerCase() !== owner.toLowerCase()) throw new StripeCustomerLinkInProgress("Stripe customer linking lease changed; retry login");
      await manager.query("UPDATE users SET stripe_customer_id = @1 WHERE id = @0 AND stripe_customer_id IS NULL", [userId, customerId]);
      await manager.query("UPDATE stripe_customer_links SET lease_owner = NULL, lease_expires_at = NULL WHERE user_id = @0 AND lease_owner = @1", [userId, owner]);
      return new User({ ...user, stripeCustomerId: customerId });
    });
  }

  public async release(userId: string, owner: string): Promise<void> {
    await this.dataSource.query("UPDATE stripe_customer_links SET lease_owner = NULL, lease_expires_at = NULL WHERE user_id = @0 AND lease_owner = @1", [userId, owner]);
  }

  private async lockUser(manager: EntityManager, userId: string): Promise<User> {
    // This row lock serializes claims/completions across all API replicas.
    const locked: { readonly id: string }[] = await manager.query("SELECT id FROM users WITH (UPDLOCK, HOLDLOCK) WHERE id = @0", [userId]);
    if (!locked[0]) throw new Error("User does not exist");
    const record: InfraUser | null = await manager.getRepository(InfraUser).findOneBy({ id: userId });
    if (!record) throw new Error("User does not exist");
    return new User({ ...record });
  }
}

