# Plan subscriptions

## Public plan catalog

`GET /plans` requires no session and returns active local plans with a non-null Stripe product mapping, ordered by local `price` and then `id`. It returns an array containing `id`, `name`, `price`, `vcpu`, `memory`, `deployments`, `disk`, and `max_replicas`; no available plans returns `[]`. Stripe IDs and internal activity fields are omitted.

The listing uses one SQL read and does not call Stripe. Its `price` is the local catalog value, not a Stripe price quote: Checkout bills the linked product's configured default price. Keep local display pricing aligned with Stripe administratively. A mapped plan can still fail Checkout if its Stripe product/default price is inactive or invalid. Storage quota describes the configured plan; storage allocation enforcement remains future work.

## Start Checkout

`POST /plans/:id/subscriptions` creates a Stripe-hosted Checkout Session in subscription mode for the authenticated user's persisted Stripe customer. `:id` is the local plan ID, not a Stripe Product ID. The plan must be active and mapped through `stripe_product_id`.

Send the GitHub session cookie and an `Idempotency-Key`. The plan is selected only through the URL, for example `POST /plans/starter/subscriptions`. No request body is needed; `{}` is also accepted. All nonempty bodies are rejected, including `price_id`, customer IDs, amounts, and redirect URLs.

The backend retrieves the plan's linked Stripe product with its expanded `default_price`. Configure the approved price as that product's default in the Stripe Dashboard. The product and default price must both be active, the default price must belong to that product, and it must use licensed recurring billing. Missing, inactive, one-time, metered, or mismatched default prices fail closed with 503. The API never lists other prices or picks a fallback. Stripe's configured default price determines the billed amount, currency, and interval; the API does not construct a price from `plans.price`. See [Stripe default prices](https://docs.stripe.com/api/products/object#product_object-default_price).

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
- **503:** Stripe lookup/session creation unavailable or the product/default price is misconfigured. Retry transient failures with the same key; correct invalid Stripe configuration before trying again.

The API supplies the linked customer, the validated product default price at quantity one, `mode: subscription`, and `ui_mode: hosted`. It does not directly create an incomplete subscription or return payment confirmation secrets. Webhooks, usage meters, monetary allowances, overage billing, and automatic subscription changes remain separate work.
