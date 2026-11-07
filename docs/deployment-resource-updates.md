# Deployment resource updates

The backend can queue compute/scaling changes without building another image or replacing a deployment. Admission is disabled by default. The frontend resource editor submits authenticated requests through the generated client and polls the accepted operation before refreshing applied values.

## API

`PATCH /deployments/:id` requires an active, unsuspended owner session, `DeploymentUpdate`, `Idempotency-Key` (1–255 printable ASCII characters), and `If-Match` containing the opaque `configuration_version` returned by a fresh deployment GET. Super permissions do not bypass ownership. Send all four numeric fields; nulls, numeric strings, missing fields, unknown fields, and fields outside this slice are rejected:

```json
{
  "max_vcpu": 1,
  "max_memory": 2,
  "min_scaling": 0,
  "max_scaling": 3
}
```

CPU must be finite, positive and a multiple of 0.25; RAM in GiB must equal twice CPU. Replica limits are integers with `0 <= min_scaling <= max_scaling` and `max_scaling >= 1`. An active Stripe subscription must map to one active local plan covering CPU, RAM and maximum replicas together. CPU/RAM limits apply per replica. Editing an existing deployment does not consume a new deployment slot.

The response is HTTP 202 with an immutable receipt (`operation_id`, `deployment_id`, `status: PENDING`, `requested`) and `Location: /deployments/:id/resource-updates/:operationId`. Retrying the same scoped key/body/version returns that receipt, including after completion or admission being disabled. A changed fingerprint returns 422. Missing `If-Match` returns 428; stale versions return 412. Busy, quota and unsupported lifecycle/revision baselines return 409. Feature-disabled admission returns 503. External read failures remain safe 502/503 errors.

`GET /deployments/:id/resource-updates/:operationId` requires the owner's session and `DeploymentRead`. It returns requested and observed configuration, status, target revision, no-op result, timestamps and safe error fields. It does not expose billing identifiers, key hashes, fingerprints or internal claim tokens. Both routes use `private, no-store` HTTP policy.

Deployment detail/list responses add nullable `configuration_version` and `resource_update` (the latest operation). Lifecycle status and resource-update status are independent. Applied reads continue to query Azure; requested changes do not replace applied values. A missing stable revision snapshot produces a null version and cannot authorize a mutation. Active updates use the short deployment read-cache TTL.

## Execution and recovery

The `deployment_resource_updates` SQL queue stores requested resources, a minimal baseline, a separate immutable receipt, claims and observed outcomes. Acceptance inserts the command and sets `deployments.active_resource_update_id` in one user/deployment-locked UnitOfWork. SQL indexes allow one unfinished command per deployment and one record per scoped key hash. Creation request JSON is not updated by resource commands.

The worker transitions `PENDING -> APPLYING -> SUCCEEDED / FAILED / RECONCILING`. Claims and heartbeats use SQL server time and token fencing. Start/stop/redeploy/delete compare-and-set transitions and provisioning/deletion claims exclude active resource commands. Volume mutations acquire the same operation lease and check the active pointer. Finalization clears the pointer only while it still belongs to that command, in the same transaction as the terminal state.

Only Single revision mode without pinned/split traffic is supported. Fresh preflight verifies ARM identity, deployment tag, current shared or legacy environment, main container, image, successful provisioning, latest/ready revision agreement, and revision compute. A version hashes the normalized identity, image, main container, revision and compute snapshot. Timestamps and polling state do not affect it.

The Azure merge PATCH retains the complete live template, containers/init containers, images, environment and secret references, probes, volumes/mounts, service bindings, scale rules and other resource properties. It changes the main container's CPU/RAM, minimum/maximum replicas, deterministic revision suffix and operation tag. It does not round-trip root secrets, ingress, identities, traffic rules or environment configuration. A no-op succeeds only after fresh stable verification under the lease and sends no PATCH.

A safe target revision marker is persisted before an ARM write. An expired claim, aborted lease, lost response or timeout after potential submission enters reconciliation. Recovery reads Azure and verifies the exact target revision, preserved image and requested resources; poller completion, an operation tag or a matching app template alone cannot establish success. Zero replicas are allowed. A definitive failed target can finish FAILED without claiming rollback. Unknown outcomes retain the active pointer and are never blindly resubmitted.

SQL locks serialize Kumo writers. They cannot cancel an ARM request already accepted by Azure or fence external operators. ARM optimistic conditional update is not claimed. Redeployment admission and its final image PATCH recheck stable live allocation and current plan limits instead of relying on creation-time compute.

## Rollout and operation

1. Apply appended migration `DeploymentResourceUpdates1794096000000` and deploy every API replica with the new mutation guards before accepting commands. The runtime identity also needs `Microsoft.App/containerApps/revisions/read`; this is included in `infra/azure/iam.bicep`.
2. Validate Single rollout/readiness, failed rollout, scale-to-zero, SDK payload preservation and crash recovery on a separate Azure environment. Local builds and mocks do not prove those cloud behaviors.
3. Enable the existing App Configuration global boolean flag `DeploymentResourceUpdates`. Missing, disabled, duplicate, conditional or variant definitions reject admission. Local configuration supplies no enabled flags. Disabling admission does not stop processing accepted commands or reconciliation.
4. STOPPED updates are explicitly rejected with `RESOURCE_STOPPED_UNSUPPORTED`. The installed ARM model exposes `runningStatus` as read-only, and stopped preservation has not been demonstrated for this implementation. Enable such support only after environment-specific proof and an adapter implementation that keeps the app stopped throughout. Never simulate support by starting then stopping it.
5. Monitor overdue reconciliation alerts (default one hour, configurable with `DEPLOYMENT_RESOURCE_UPDATE_RECONCILIATION_ALERT_MS`, minimum one minute). Inspect the stored operation ID/target revision alongside Azure operation history and the serving revision. Restore a stable baseline or resolve the command through an evidence-based recovery procedure. Do not manually clear a pointer while an earlier PATCH might still run.
6. Drain or resolve all unfinished commands before removing guards, rolling back to older API replicas, or running the down migration. The down migration rejects unfinished commands. A failed rollout may leave an unsettled template; subsequent update/redeploy admission stays blocked until operators restore a stable ready baseline.

The frontend sends the baseline `configuration_version` and a retry-stable idempotency key from an authenticated Next.js server action. It polls the owner-scoped operation after 202, presents queued/applying/reconciling/failed results, and refreshes applied values after verified success. Drafts survive request failures, and ambiguous submissions retain their original key and settings for safe retry. Reopening the editor can resume an active operation. Requested resources are not optimistically presented as applied.

The UI reports backend admission errors, including `RESOURCE_UPDATES_DISABLED`, rather than simulating a save. With the current `CONFIG_SOURCE=local` implementation, feature flags are empty and resource admission remains disabled; connecting the frontend does not enable the backend flag. Azure App Configuration enablement and rollout prerequisites remain separate operator actions. STOPPED deployments and reads without a verified version cannot submit changes.

## Validation status

The API and web production builds pass (`npm run build:api` and `npm run build --workspace @kumo/web -- --webpack`); both web and test TypeScript checks pass. The independently authored resource domain, admission, worker, Azure adapter and HTTP tests pass (20/20). The separate SQL Server integration test was not run because no `TEST_SQLSERVER_*` database is configured. No tests were authored or modified as part of the implementation task, and no application database migration or live Azure/Stripe mutation was executed.
