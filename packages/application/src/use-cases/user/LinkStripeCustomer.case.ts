import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { User } from "@kumo/domain";
import { StripeCustomerLinkInProgress, type StripeCustomerGateway, type StripeCustomerLinkClaim, type StripeCustomerLinkRepository } from "../../ports/stripe.js";

export class LinkStripeCustomerCase {
  public constructor(
    private readonly repository: StripeCustomerLinkRepository,
    private readonly stripe: StripeCustomerGateway,
  ) {}

  public async exec(userId: string): Promise<User> {
    const owner: string = randomUUID();
    const deadline: number = Date.now() + 30_000;
    while (true) {
      const claim: StripeCustomerLinkClaim = await this.repository.claim(userId, owner);
      if (claim.state === "linked") return claim.user;
      if (claim.state === "busy") {
        if (Date.now() >= deadline) throw new StripeCustomerLinkInProgress("Stripe customer linking is still in progress; retry login");
        await setTimeout(100);
        continue;
      }
      try {
        const customer: { readonly id: string } = await this.stripe.createCustomer(userId, claim.idempotencyKey);
        return await this.repository.complete(userId, owner, customer.id);
      } catch (error: unknown) {
        // Keep the original operation and key even after failures or uncertain outcomes.
        await this.repository.release(userId, owner).catch((): void => undefined);
        throw error;
      }
    }
  }
}
