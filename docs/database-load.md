# Database load reduction

The optimizations preserve durable SQL queues, per-user acceptance locking, business receipts, and permission freshness. They do not change quota eligibility or move authoritative state into a cache.

## Worker scheduling and claims

Build and deployment workers still check their local timers every second. Empty queues back off their database claims through base intervals of 1, 2, 4, 8, and 10 seconds, with up to 25% downward jitter to spread replicas. Finding work resets the delay; busy workers retain their existing bounded batches and per-instance concurrency. Stale-work cleanup runs once per minute when the worker is available, rather than before every claim. An in-flight job still completes before shutdown.

Each claim is one ordered `UPDATE … OUTPUT` statement. `UPDLOCK`, `READPAST`, and `READCOMMITTEDLOCK` protect competing workers and support databases with `READ_COMMITTED_SNAPSHOT` enabled. See [SQL Server table hints](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table). The deployment queue gains a filtered `(status, created_at, id)` index for records with creation requests, so claim ordering can use an index without scanning/sorting unrelated legacy rows. The existing status/updated-at index remains for stale sweeps. The migration only adds an index and preserves historical migrations and data.

## Writes and admission

New deployment/build records use explicit inserts. Workflow updates target mutable progress columns; deployment progress does not rewrite the creation-request JSON, name, or creation timestamp. Rename updates only name and update time. Build status refreshes update only run/status fields when they actually change. A conditional status/run-ID match prevents an older refresh from overwriting a concurrent terminal state; responses return the persisted winner. Terminal builds skip polling. Concurrent refreshes of the same build and owner share one in-flight read/refresh within an API process; completed work is not retained as a user or status cache.

Acceptance obtains the existing reservation count using SQL `COUNT(*)` inside the same locked UoW. It no longer loads every deployment/spec to count them in JavaScript. The existing reservation predicate, Stripe verification, uniqueness constraints, and receipt/deployment atomicity remain unchanged.

## Authentication and sessions

Session deserialization obtains the current user and active assigned-role bitsets through one joined SQL query, without opening a read-only UoW transaction. It constructs a fresh domain user and attaches the computed grants under a non-enumerable symbol for this request. Only the user ID is serialized into the session store. Guards check user eligibility and this fresh mask before cached responses or idempotency replay. When no deserialized mask is present, the existing fresh role-lookup path remains available. Role changes and suspensions take effect on the next request; there is no cross-request authorization TTL.

Mongo sessions use `resave: false` and `touchAfter: 300`. Unmodified sessions avoid full saves, expiry-only touches are throttled, and modifications still persist. SQL user/role reads and Mongo session storage are separate sources of load.

## Response caching

Responses remain scoped to user, route/query, and deployment cache generation. Concurrent misses for the same key share one in-flight operation within the process. Errors release the in-flight entry and are not cached. Request cache-bypass directives skip both cached results and miss coalescing.

| Response | TTL |
| --- | --- |
| Pending/provisioning deployments, mixed lists, or other deployment workflow states | 2 seconds |
| Running/stopped deployment detail or lists containing only those states | 10 seconds |
| Nonterminal build status | 2 seconds |
| Terminal build status (SUCCEEDED/FAILED/CANCELED) | 30 seconds |
| Monitoring | Existing 60 seconds |

Mutation invalidation and permission checks before cache hits remain in place. Applied Azure configuration can therefore be up to ten seconds old on a normal running/stopped GET. Coalescing is process-local; Redis response entries and invalidation generations remain shared across instances.

Run `npm run test:api` for behavioral checks. The separate SQL suite tests concurrent queue claims, targeted-update retention, aggregate quota checks, authorization revocation, and terminal build protection with read-committed snapshot enabled. Apply the new index migration before evaluating claim query plans and compare real workloads; static query reductions are not a measured production-cost guarantee.
