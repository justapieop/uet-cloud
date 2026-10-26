import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Role, User } from "@kumo/domain";
import { StripeCustomerLinkReconciliationRequired, type StripeCustomerGateway, type StripeCustomerLinkClaim, type StripeCustomerLinkRepository } from "../dist/ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../dist/ports/uow.js";
import { LinkStripeCustomerCase } from "../dist/use-cases/user/LinkStripeCustomer.case.js";
import { CreateUserCase } from "../dist/use-cases/user/CreateUser.case.js";
import { emptyRepositories } from "./support/repositories.ts";

class MemoryLinks implements StripeCustomerLinkRepository {
  public user: User = new User({ id: "123", displayName: "Alice", suspended: false });
  public readonly key: string = `kumo:stripe:customer:${randomUUID()}`;
  public owner: string | null = null;
  public failCompletion: boolean = false;
  public expired: boolean = false;
  public async claim(_userId: string, owner: string): Promise<StripeCustomerLinkClaim> {
    if (this.user.stripeCustomerId || this.user.suspended) return { state: "linked", user: this.user };
    if (this.expired) throw new StripeCustomerLinkReconciliationRequired("Reconcile first");
    if (this.owner) return { state: "busy" };
    this.owner = owner;
    return { state: "create", idempotencyKey: this.key };
  }
  public async complete(_userId: string, owner: string, customerId: string): Promise<User> {
    assert.equal(owner, this.owner);
    if (this.failCompletion) { this.failCompletion = false; throw new Error("SQL commit failed"); }
    this.user = new User({ ...this.user, stripeCustomerId: customerId });
    this.owner = null;
    return this.user;
  }
  public async release(_userId: string, owner: string): Promise<void> {
    if (this.owner === owner) this.owner = null;
  }
}

class MemoryStripe implements StripeCustomerGateway {
  public readonly calls: { readonly userId: string; readonly key: string }[] = [];
  public readonly customers: Map<string, string> = new Map<string, string>();
  public loseResponse: boolean = false;
  public async createCustomer(userId: string, key: string): Promise<{ readonly id: string }> {
    this.calls.push({ userId, key });
    const id: string = this.customers.get(key) ?? `cus_${this.customers.size + 1}`;
    this.customers.set(key, id);
    if (this.loseResponse) { this.loseResponse = false; throw new Error("Response lost after Stripe committed"); }
    return { id };
  }
}

test("concurrent logins across linker instances converge on one customer", async (): Promise<void> => {
  const store: MemoryLinks = new MemoryLinks();
  const stripe: MemoryStripe = new MemoryStripe();
  const users: User[] = await Promise.all(Array.from({ length: 8 }, (): Promise<User> => new LinkStripeCustomerCase(store, stripe).exec("123")));
  assert.equal(stripe.calls.length, 1);
  assert.equal(stripe.customers.size, 1);
  assert.ok(users.every((user: User): boolean => user.stripeCustomerId === "cus_1"));
});

test("lost Stripe responses reuse the persisted key on a later login", async (): Promise<void> => {
  const store: MemoryLinks = new MemoryLinks();
  const stripe: MemoryStripe = new MemoryStripe();
  stripe.loseResponse = true;
  await assert.rejects(new LinkStripeCustomerCase(store, stripe).exec("123"), /Response lost/);
  assert.equal(store.user.stripeCustomerId, null);
  const linked: User = await new LinkStripeCustomerCase(store, stripe).exec("123");
  assert.equal(linked.stripeCustomerId, "cus_1");
  assert.equal(stripe.customers.size, 1);
  assert.equal(stripe.calls[0]!.key, stripe.calls[1]!.key);
});

test("a failed database completion does not cause another Stripe customer", async (): Promise<void> => {
  const store: MemoryLinks = new MemoryLinks();
  const stripe: MemoryStripe = new MemoryStripe();
  store.failCompletion = true;
  await assert.rejects(new LinkStripeCustomerCase(store, stripe).exec("123"), /SQL commit failed/);
  const linked: User = await new LinkStripeCustomerCase(store, stripe).exec("123");
  assert.equal(linked.stripeCustomerId, "cus_1");
  assert.equal(stripe.customers.size, 1);
});

test("already linked and suspended users do not call Stripe", async (): Promise<void> => {
  const stripe: MemoryStripe = new MemoryStripe();
  const store: MemoryLinks = new MemoryLinks();
  store.user = new User({ ...store.user, stripeCustomerId: "cus_existing" });
  assert.equal((await new LinkStripeCustomerCase(store, stripe).exec("123")).stripeCustomerId, "cus_existing");
  store.user = new User({ ...store.user, stripeCustomerId: null, suspended: true });
  assert.equal((await new LinkStripeCustomerCase(store, stripe).exec("123")).suspended, true);
  assert.equal(stripe.calls.length, 0);
});

test("uncertain operations beyond the replay window never call create again", async (): Promise<void> => {
  const store: MemoryLinks = new MemoryLinks();
  const stripe: MemoryStripe = new MemoryStripe();
  store.expired = true;
  await assert.rejects(new LinkStripeCustomerCase(store, stripe).exec("123"), StripeCustomerLinkReconciliationRequired);
  assert.equal(stripe.calls.length, 0);
});

test("creation and legacy-user login link only after the UoW commits", async (): Promise<void> => {
  const store: MemoryLinks = new MemoryLinks();
  const stripe: MemoryStripe = new MemoryStripe();
  let saved: User | null = null;
  let inTransaction: boolean = false;
  let writes: number = 0;
  const repositories: UnitOfWorkRepositories = {
    ...emptyRepositories(),
    roles: { ...emptyRepositories().roles, findByIdForUpdate: async (id: string): Promise<Role | null> => new Role({ id, name: id }) },
    userRoles: { ...emptyRepositories().userRoles, replaceForUser: async (): Promise<void> => {} },
    users: {
      findByIdForUpdate: async (): Promise<User | null> => saved,
      findById: async (): Promise<User | null> => saved,
      exists: async (): Promise<boolean> => saved !== null,
      save: async (user: User): Promise<void> => { saved = user; writes++; },
    },
  };
  const uow: UnitOfWork = {
    async run<T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
      inTransaction = true;
      try { return await work(repositories); } finally { inTransaction = false; }
    },
  };
  const linker: Pick<LinkStripeCustomerCase, "exec"> = {
    exec: async (id: string): Promise<User> => {
      assert.equal(inTransaction, false);
      assert.ok(saved);
      return new LinkStripeCustomerCase(store, stripe).exec(id);
    },
  };
  const create: CreateUserCase = new CreateUserCase(uow, linker);
  assert.equal((await create.exec("123", "Alice")).stripeCustomerId, "cus_1");
  assert.equal(writes, 1);
  // Simulate another login while the user already exists locally.
  assert.equal((await create.exec("123", "Ignored")).stripeCustomerId, "cus_1");
  assert.equal(writes, 1);
  assert.equal(stripe.calls.length, 1);
});
