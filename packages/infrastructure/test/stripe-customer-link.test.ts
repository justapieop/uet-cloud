import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "@kumo/domain";
import { StripeCustomerLinkInProgress, StripeCustomerLinkReconciliationRequired } from "@kumo/application";
import type { DataSource, EntityManager, Repository } from "typeorm";
import { InfraStripeCustomerLinkRepository } from "../dist/db/repositories/stripe-customer-link.js";
import { InfraUserRepository, type InfraUser } from "../dist/db/repositories/user.js";

interface Fixture {
  user: { id: string; displayName: string; suspended: boolean; stripeCustomerId: string | null };
  operation: { operation_id: string; first_attempt_at: Date; lease_owner: string | null; lease_expires_at: Date | null } | null;
  readonly repo: InfraStripeCustomerLinkRepository;
}

function fixture(): Fixture {
  const state: Fixture = {
    user: { id: "123", displayName: "Alice", suspended: false, stripeCustomerId: null },
    operation: null,
  } as Fixture;
  const query: (sql: string, params?: unknown[]) => Promise<unknown[]> = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    if (sql.startsWith("SELECT id FROM users")) { assert.match(sql, /UPDLOCK, HOLDLOCK/); return [{ id: "123" }]; }
    if (sql.startsWith("SELECT operation_id")) return state.operation ? [{ ...state.operation, operation_id: state.operation.operation_id.toUpperCase(), lease_owner: state.operation.lease_owner?.toUpperCase() ?? null }] : [];
    if (sql.startsWith("SELECT SYSUTCDATETIME")) return [{ now: new Date() }];
    if (sql.startsWith("INSERT INTO stripe_customer_links")) {
      assert.equal(state.operation, null);
      state.operation = { operation_id: params[1] as string, first_attempt_at: new Date(), lease_owner: params[2] as string, lease_expires_at: new Date(Date.now() + 120_000) };
      return [];
    }
    if (sql.startsWith("UPDATE stripe_customer_links SET lease_owner = @1")) {
      assert.ok(state.operation);
      state.operation.lease_owner = params[1] as string;
      state.operation.lease_expires_at = new Date(Date.now() + 120_000);
      return [];
    }
    if (sql.startsWith("UPDATE stripe_customer_links SET lease_owner = NULL")) {
      if (state.operation?.lease_owner === params[1]) { state.operation.lease_owner = null; state.operation.lease_expires_at = null; }
      return [];
    }
    if (sql.startsWith("UPDATE users SET stripe_customer_id")) { assert.equal(state.user.stripeCustomerId, null); state.user.stripeCustomerId = params[1] as string; return []; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const manager: EntityManager = { query, getRepository: (): unknown => ({ findOneBy: async (): Promise<unknown> => ({ ...state.user }) }) } as unknown as EntityManager;
  const source: DataSource = { query, transaction: async <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> => work(manager) } as unknown as DataSource;
  Object.assign(state, { repo: new InfraStripeCustomerLinkRepository(source) });
  return state;
}

test("claims wait while leased, and reclaiming after a crash preserves the operation key", async (): Promise<void> => {
  const state: Fixture = fixture();
  const first: unknown = await state.repo.claim("123", "owner-one");
  assert.deepEqual(await state.repo.claim("123", "owner-two"), { state: "busy" });
  assert.ok(state.operation);
  state.operation.lease_expires_at = new Date(0);
  assert.deepEqual(await state.repo.claim("123", "owner-two"), first);
  await assert.rejects(state.repo.complete("123", "owner-one", "cus_old"), StripeCustomerLinkInProgress);
  assert.equal(state.user.stripeCustomerId, null);
  await state.repo.release("123", "owner-one");
  assert.equal(state.operation.lease_owner, "owner-two");
  assert.equal((await state.repo.complete("123", "owner-two", "cus_one")).stripeCustomerId, "cus_one");
});

test("old uncertain operations stop before another Stripe request can be made", async (): Promise<void> => {
  const state: Fixture = fixture();
  await state.repo.claim("123", "owner");
  assert.ok(state.operation);
  state.operation.first_attempt_at = new Date(Date.now() - 23 * 60 * 60 * 1000);
  await assert.rejects(state.repo.claim("123", "other"), StripeCustomerLinkReconciliationRequired);
});

test("completion never replaces a different existing customer ID", async (): Promise<void> => {
  const state: Fixture = fixture();
  state.user.stripeCustomerId = "cus_existing";
  await assert.rejects(state.repo.complete("123", "owner", "cus_other"), /refusing to replace/);
  assert.equal(state.user.stripeCustomerId, "cus_existing");
});

test("ordinary user saves never write a stale Stripe association", async (): Promise<void> => {
  let written: unknown;
  const orm: Repository<InfraUser> = {
    create: (value: unknown): unknown => { written = value; return value; },
    save: async (): Promise<void> => {},
  } as unknown as Repository<InfraUser>;
  const repo: InfraUserRepository = new InfraUserRepository(orm);
  await repo.save(new User({ id: "123", displayName: "Updated", suspended: false, stripeCustomerId: null }));
  assert.equal(Object.hasOwn(written as object, "stripeCustomerId"), false);
});

