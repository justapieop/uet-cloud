# Admin plan and subscription APIs

Management operations share the existing `/plans` and `/user` routes, without an admin prefix. Public `GET /plans`, signed-in `GET /plans/me`, and checkout `POST /plans/:id/subscriptions` keep their existing behavior.

All management routes require an authenticated, active, unsuspended user. `PlanManage` (offset 7) grants plan administration; `SubscriptionManage` (offset 8) grants cross-user subscription administration. Existing admin Super grants both; ordinary roles receive no new grants automatically. Responses use `private, no-store`.

| Method and path | Permission | Result |
| --- | --- | --- |
| `GET /plans/all?page=1&per_page=30` | PlanManage | All local plans, including inactive and unmapped |
| `GET /plans/:id` | PlanManage | One local plan |
| `POST /plans` | PlanManage | Create a local plan; 201 |
| `PUT /plans/:id` | PlanManage | Replace all configuration fields; 200 |
| `DELETE /plans/:id` | PlanManage | Deactivate without removing the row; 204 |
| `GET /user/:userId/subscriptions?limit=30&starting_after=sub_...` | SubscriptionManage | Cursor-paginated Stripe subscriptions in all statuses |
| `PATCH /user/:userId/subscriptions/:subscriptionId` | SubscriptionManage | Schedule or undo period-end cancellation |

## Plans

POST accepts:

```json
{
  "id": "starter",
  "name": "Starter",
  "price": 5,
  "vcpu": 1,
  "memory": 2,
  "deployments": 2,
  "disk": 10,
  "active": true,
  "stripe_product_id": "prod_example",
  "max_replicas": 3
}
```

PUT requires the same fields except `id`, which comes from the URL. `stripe_product_id` can be null. Unknown fields are rejected; memory must equal twice vCPU, quotas must be positive, and local price must be nonnegative. Duplicate IDs/product mappings return 409; missing rows return 404. No Stripe products/prices are created or edited. Checkout validates the configured mapping against Stripe; local `price` is catalog metadata.

DELETE sets `active=false`. It does not cancel Stripe subscriptions, issue refunds, delete the row, or modify existing deployments. Plan activity/quota changes affect subsequent eligibility and admission checks, including existing subscribers. PUT can reactivate a plan.

`GET /plans/all` is ordered by ID and returns `{ "plans": [], "page": 1, "per_page": 30, "has_next_page": false }`. Page size is 1–100 and page is 1–1000000. Admin plan responses include the public plan fields plus `active` and `stripe_product_id`.

## Subscriptions

The target user's persisted Stripe customer determines the subscription scope; a client-supplied customer ID is never accepted. A missing user returns 404. An unlinked user returns an empty list. Listing returns `subscriptions`, `has_more`, and `next_cursor`. Each subscription includes `id`, `status`, `cancel_at_period_end`, `cancel_at` (Unix timestamp or null), and all price/product item IDs, following nested item pagination. Payment secrets and payment methods are omitted.

PATCH requires an `Idempotency-Key` and only:

```json
{ "cancel_at_period_end": true }
```

False undoes a scheduled cancellation while Stripe allows it; it does not restart an ended subscription. The backend retrieves the subscription and verifies its customer matches the selected user before updating. Foreign subscriptions return 404 without mutation. Only the cancellation flag changes: price items, metered components, and billing cycle settings are preserved. Stripe determines the effective cancellation time and final billing behavior. See [Stripe subscription updates](https://docs.stripe.com/api/subscriptions/update).

Retry uncertain mutations with the same key, actor, user, subscription, and body. The key is hashed with those identities and uses Stripe's native retention. Changed parameters or incompatible Stripe state can return 409; unavailable Stripe calls return 503. Stripe calls run outside SQL transactions. Pagination and unknown/malformed body fields produce 400; missing grants produce 403.

Public plan selection and Checkout remain separate. No live Stripe calls or application-data mutations occur in normal backend tests; real plan CRUD/uniqueness coverage belongs to the isolated SQL integration suite.
