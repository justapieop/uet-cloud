# Resilience and idempotency

## Deployment creation

`POST /deployments` requires an authenticated, unsuspended user and an `Idempotency-Key` header containing 1–255 printable ASCII characters. Generate one key per user action and preserve it across retries. Use a new key when changing the request.

```http
POST /deployments
Idempotency-Key: 2c24e123-0a35-4fd8-bd10-580c351a492a
Content-Type: application/json
```

The body remains the existing deployment DTO. Successful creation returns HTTP 202. Repeating an accepted request returns its original accepted deployment ID and snapshot, even if provisioning has progressed. Query `GET /deployments/:id` for current status.

Within the HTTP receipt retention period, Nest's idempotency interceptor returns the stored response with `Idempotent-Replayed: true`. A concurrent in-flight key returns 409; a different request using the same key returns 422. Missing/invalid keys return 400. Keys are scoped by authenticated user, and the request fingerprint includes the HTTP method, URL, and body. Guards reject suspended users before receipt replay.

`SqlServerIdempotencyStore` uses SQL transactions, row/range locks, database time, and owner-checked completion/renewal/release. HTTP receipts default to 24 hours, with a renewable 30-second in-flight lease and a two-minute maximum renewal period. Store calls have a five-second wait budget. Expired HTTP records are removed in bounded batches every minute. Successes and 400/422 outcomes are stored; 409 and server failures are released for another attempt. A store outage does not fall back to an unprotected create.

A second table, `deployment_request_receipts`, stores the accepted deployment snapshot and fingerprint in the same unit of work as the deployment insert. A transaction-scoped application lock serializes a key. This closes the crash window between deployment commit and HTTP receipt completion. These business receipts are retained without expiry: after the HTTP receipt expires, a matching key still returns the original acceptance; a changed payload is rejected. Never recycle deployment creation keys. The saved snapshot excludes environment variable secrets. These receipts survive deployment deletion; they are not foreign-key-cascaded away.

## Dependency policies

`AppIdempotencyModule` is registered before `AppResilienceModule`. Domain and application code remain independent of both NestJS packages. Infrastructure provides the SQL store and HTTP/SDK adapters; presentation composes the policies and clients.

| Dependency | Timeout per read attempt | Total read attempts |
| --- | --- | --- |
| GitHub | 15 seconds | 3 |
| Azure DevOps | 10 seconds | 3 |
| Azure Resource Manager | 30 seconds | 3 |
| Azure Monitor | 5 seconds | 3 |
| Key Vault | 15 seconds | 3 |
| ACR | 30 seconds | 3 |
| Source upload/download transport fallback | 120 seconds | 3 for safe reads only |
| Redis response cache | 300 milliseconds | 1 |

Only GET/HEAD/OPTIONS requests retry. POST/PUT/PATCH/DELETE are single-attempt, including pipeline submission and ARM writes. Write timeouts are at least 30 seconds. A write timing out may already have reached the provider; it is not proof that no resource or pipeline run exists. Retrying the accepted deployment HTTP request never reruns its workflow.

Read retries cover network failures, timeouts, HTTP 408/429, and selected HTTP 5xx responses. They use exponential backoff with jitter, capped at two seconds. A Retry-After value up to five seconds is honored; a longer value stops automatic retry rather than calling sooner than the provider permits. Authentication, permission, validation, missing-resource, policy, region, and build-result errors are not retried.

Each dependency has a circuit breaker shared by its read/write policies, opening at 50% failures after at least 10 calls in a 20-call window. It probes after 30 seconds. Default concurrency is 10 with 10 waiting slots and a one-second queue wait. Cache has no waiting slots. Breakers and concurrency limits apply per API process, not globally across replicas.

Azure SDK retries are disabled for configured clients. A pipeline policy bounds and retries individual HTTP requests, preserving the existing long-running operation poller and overall deployment deadline. Azure request policy executions have a 120-second total budget as well as per-attempt timeouts. HTTP transport policies preserve the providers' original abort signals, including their response-body/download deadlines. Cache commands cannot be cancelled once submitted; a timeout bypasses their results and may leave an underlying Redis operation finishing in the background.

The response cache remains optional and user-scoped. Cache failure does not bypass authentication or suspension checks. API resilience timeouts and circuit/concurrency rejections use Nest's native 504/503 mappings. Worker retry exhaustion retains the existing failure behavior; this change does not introduce durable workflow recovery, payment handling, or subscriptions.

Circuit transitions, rejections, timeouts, and retry counts are logged using fixed policy names. Logs omit request URLs, payloads, credentials, and raw upstream errors.

## Configuration

All values are validated as positive integers during startup.

- `IDEMPOTENCY_TTL_MS`: HTTP receipt retention, default 86400000, maximum 2592000000.
- `RESILIENCE_READ_ATTEMPTS`: total safe-read attempts, default 3, maximum 5.
- `RESILIENCE_MAX_CONCURRENT`: concurrent requests per dependency and replica, default 10, maximum 1000.
- `RESILIENCE_OPEN_MS`: circuit open duration, default 30000.
- `RESILIENCE_CACHE_TIMEOUT_MS`: cache call timeout, default 300.
- `RESILIENCE_<DEPENDENCY>_TIMEOUT_MS`: read-attempt timeout override. Dependency names are `GITHUB`, `AZURE_DEVOPS`, `AZURE_ARM`, `AZURE_MONITOR`, `KEY_VAULT`, `ACR`, and `SOURCE_UPLOAD`.

The appended `Reliability1792272000001` migration creates both SQL Server tables. Existing API startup configuration runs pending migrations; no database migration is performed by source compilation. Rolling back this migration deletes idempotency records and acceptance receipts.

Reference: [NestJS resilience](https://docs.nestjs.com/reliability/resilience) and [idempotency keys](https://docs.nestjs.com/reliability/idempotency).
