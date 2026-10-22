# Plan subscriptions

## Public plan catalog

`GET /plans` requires no session and returns active local plans with a non-null Stripe product mapping, ordered by local `price` and then `id`. It returns an array containing `id`, `name`, `price`, `vcpu`, `memory`, `deployments`, `disk`, and `max_replicas`; no available plans returns `[]`. Stripe IDs and internal activity fields are omitted.

The listing uses one SQL read and does not call Stripe. Its `price` is the local catalog value, not a Stripe price quote: Checkout includes all active prices of the linked product. Keep local display pricing aligned with Stripe administratively. A mapped plan can still fail Checkout if its Stripe product or active price configuration is invalid. Storage quota describes the configured plan; storage allocation enforcement remains future work.

## Current user's plans

`GET /plans/me` requires the GitHub session cookie and an active, unsuspended user. It returns `{ "has_plan": false, "plans": [] }` when the user has no linked Stripe customer, no active subscriptions, or no active local plans matching the subscribed products. Otherwise it returns `has_plan: true` and the matching plans using the same public fields as `GET /plans`.

The endpoint reads the persisted user, checks that user's linked customer's active subscriptions directly with Stripe, and matches products through the active-plan repository used by deployment admission. Multiple subscribed plans are returned separately; their quotas are not combined. A pending Checkout Session, incomplete subscription, or browser redirect does not establish an active plan. No billing/customer/subscription IDs are exposed, and client-supplied user IDs do not select another account.

Responses use `private, no-store`. Stripe verification failures return 503 rather than `has_plan: false`; the frontend should show a retryable error instead of prompting another purchase. This endpoint reports plan membership only: it does not indicate remaining quotas, reserve resources, or replace deployment admission checks. An unlinked user is not automatically linked by this GET; normal GitHub login handles customer linking. No deployment permission grant is required to inspect one's own billing eligibility.

## Start Checkout

`POST /plans/:id/subscriptions` creates a Stripe-hosted Checkout Session in subscription mode for the authenticated user's persisted Stripe customer. `:id` is the local plan ID, not a Stripe Product ID. The plan must be active and mapped through `stripe_product_id`.

Send the GitHub session cookie and an `Idempotency-Key`. The plan is selected only through the URL, for example `POST /plans/starter/subscriptions`. No request body is needed; `{}` is also accepted. All nonempty bodies are rejected, including `price_id`, customer IDs, amounts, and redirect URLs.

The backend verifies the linked Stripe product is active and lists **all active prices** for that product, following every result page. The product default is not used to select a subset. Recurring licensed and metered prices are included, and active one-time prices are included on the initial invoice. Archived prices are excluded. Prices are deduplicated and sorted by ID before submission so retries have stable line-item ordering.

Licensed recurring and one-time prices use quantity one. Metered recurring prices omit quantity, as required by Stripe. A subscription requires at least one recurring price. Checkout supports at most 20 recurring and 20 one-time prices; an empty/unsupported configuration returns 503 rather than silently dropping items. Stripe also validates that the combined prices are compatible (for example, currencies and billing intervals); incompatible configurations fail without creating a partial subscription. See [Stripe Checkout Session parameters](https://docs.stripe.com/api/checkout/sessions/create).

**Every active price is a component billed together, not a choice for the customer.** Archive unused legacy prices and keep monthly/yearly alternatives on separate products if they should not both be purchased. Stripe's prices determine billed amounts; `plans.price` is local catalog metadata. Clients cannot choose or omit individual prices.


The 201 response contains:

```json
{
  "checkout_session_id": "cs_example",
  "checkout_url": "https://checkout.stripe.com/c/pay/..."
}
```

Redirect the browser to `checkout_url`. Stripe hosts the payment form and creates the subscription through Checkout. No client secret or Stripe.js payment form is needed. Both success and cancellation return to the existing dashboard at `<FRONTEND_URL>/dashboard`. Set `FRONTEND_URL` in the API configuration; it must be an HTTP(S) URL without embedded credentials. Configured base paths are preserved, and query strings and fragments are removed.

A Checkout Session or return redirect does not prove payment succeeded. The deployment admission gate continues querying Stripe for `active` subscriptions directly. No local subscription state is updated from browser query parameters. See [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create).

The route requires an authenticated, active, unsuspended user with a linked Stripe customer. This is self-service billing; it does not require deployment permission grants. No local subscription rows, role grants, or deployment reservations are created. The response uses `private, no-store`.

## Retries and errors

Reuse the exact request and Idempotency-Key for retries, especially after a timeout or 503. The backend hashes the key with the authenticated user ID and checkout operation name before sending it to Stripe. Equal client keys from different users do not collide. Stripe handles concurrent/repeated creation requests and rejects changed parameters with the same key. Checkout uses a separate key namespace from the previous direct-subscription implementation.

This endpoint relies on Stripe's idempotency retention, not a permanent SQL acceptance receipt; keys can be pruned after at least 24 hours. See [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests). A new key represents a new Checkout Session and can lead to another subscription if completed. The route does not implement switching, upgrading, canceling, or deduplicating purchases under different keys. An expired or completed session may no longer have a usable Checkout URL; starting another purchase requires a new request key.

- **400:** malformed plan/key or a nonempty request body, including client-supplied prices.
- **403:** missing session, inactive/suspended user, or missing customer association; normal GitHub login establishes the customer link.
- **404:** missing, inactive, or unmapped local plan.
- **409:** conflicting or concurrently used Stripe idempotency key.
- **503:** Stripe lookup/session creation unavailable or the product or active prices are misconfigured. Retry transient failures with the same key; correct invalid Stripe configuration before trying again.

The API supplies the linked customer, all validated active product prices with quantity one for licensed/one-time items and no quantity for metered items, `mode: subscription`, and `ui_mode: hosted_page`. It does not directly create an incomplete subscription or return payment confirmation secrets. Metered prices are registered on the subscription, but publishing usage/meter events is not implemented by this endpoint. Webhooks, monetary allowances, usage reporting/overage calculation, and automatic subscription changes remain separate work.
