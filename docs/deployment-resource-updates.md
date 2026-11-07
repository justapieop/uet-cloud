# Deployment resource updates

The backend can queue compute/scaling changes without building another image or replacing a deployment. Access uses session authentication, DeploymentUpdate and ownership checks, following the same authorization pattern as metrics with a mutation-specific permission. There is no feature-flag admission gate. The frontend closes the resource editor immediately on Save, submits through the generated client, and follows progress on the original Edit button before refreshing applied values.

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

The response is HTTP 202 with an immutable receipt (`operation_id`, `deployment_id`, `status: PENDING`, `requested`) and `Location: /deployments/:id/resource-updates/:operationId`. Retrying the same scoped key/body/version returns that receipt, including after completion. A changed fingerprint returns 422. Missing `If-Match` returns 428; stale versions return 412. Busy, quota and unsupported lifecycle/revision baselines return 409. External read failures remain safe 502/503 errors.

`GET /deployments/:id/resource-updates/:operationId` requires the owner's session and `DeploymentRead`. It returns requested and observed configuration, status, target revision, no-op result, timestamps and safe error fields. It does not expose billing identifiers, key hashes, fingerprints or internal claim tokens. Both routes use `private, no-store` HTTP policy.

Deployment detail/list responses add nullable `configuration_version` and `resource_update` (the latest operation). Lifecycle status and resource-update status are independent. Applied reads continue to query Azure; requested changes do not replace applied values. A missing stable revision snapshot produces a null version and cannot authorize a mutation. Active updates use the short deployment read-cache TTL.

## Execution and recovery

The `deployment_resource_updates` SQL queue stores requested resources, a minimal baseline, a separate immutable receipt, claims and observed outcomes. Acceptance inserts the command and sets `deployments.active_resource_update_id` in one user/deployment-locked UnitOfWork. SQL indexes allow one unfinished command per deployment and one record per scoped key hash. Creation request JSON is not updated by resource commands.

The worker transitions `PENDING -> APPLYING -> SUCCEEDED / FAILED / RECONCILING`. Claims and heartbeats use SQL server time and token fencing. Start/stop/redeploy/delete compare-and-set transitions and provisioning/deletion claims exclude active resource commands. Volume mutations acquire the same operation lease and check the active pointer. Finalization clears the pointer only while it still belongs to that command, in the same transaction as the terminal state.

Only Single revision mode without pinned/split traffic is supported. Fresh preflight verifies ARM identity, deployment tag, current shared or legacy environment, main container, image, successful provisioning, latest/ready revision agreement, and revision compute. A version hashes the normalized identity, image, main container, revision and compute snapshot. Timestamps and polling state do not affect it.

The Azure merge PATCH retains the complete live template, containers/init containers, images, environment and secret references, probes, volumes/mounts, service bindings, scale rules and other resource properties. It changes the main container's CPU/RAM, minimum/maximum replicas, deterministic revision suffix and operation tag. It does not round-trip root secrets, ingress, identities, traffic rules or environment configuration. A no-op succeeds only after fresh stable verification under the lease and sends no PATCH.

A safe target revision marker is persisted before an ARM write. An expired claim, aborted lease, lost response or timeout after potential submission enters reconciliation. Recovery reads Azure and verifies the exact target revision, preserved image and requested resources; poller completion, an operation tag or a matching app template alone cannot establish success. Zero replicas are allowed. A definitive failed target can finish FAILED without claiming rollback. Unknown outcomes retain the active pointer and are never blindly resubmitted.

Azure can return revision `runningState: ScaledToZero` for an active, provisioned, healthy idle revision, although the installed SDK's known enum values omit that state. The shared readiness check accepts it only when the minimum is zero and the observed replica count is zero, alongside the existing identity, latest/ready revision, image and compute checks. This applies to both baseline reads and resource-update reconciliation. It does not authorize updates to a STOPPED Container App. See [Azure revision lifecycle states](https://learn.microsoft.com/en-us/azure/container-apps/revisions#running-status).

SQL locks serialize Kumo writers. They cannot cancel an ARM request already accepted by Azure or fence external operators. ARM optimistic conditional update is not claimed. Redeployment admission and its final image PATCH recheck stable live allocation and current plan limits instead of relying on creation-time compute.

## Rollout and operation

1. Apply appended migration `DeploymentResourceUpdates1794096000000` and deploy every API replica with the new mutation guards before accepting commands. The runtime identity also needs `Microsoft.App/containerApps/revisions/read`; this is included in `infra/azure/iam.bicep`.
2. Validate Single rollout/readiness, failed rollout, scale-to-zero, SDK payload preservation and crash recovery on a separate Azure environment. Local builds and mocks do not prove those cloud behaviors.
3. Resource updates require no feature flag. The former Azure `DeploymentResourceUpdates` flag and local `DEPLOYMENT_RESOURCE_UPDATES_ENABLED` setting are ignored. Current permission grants, owner scope, subscriptions, plan limits and baseline verification authorize each request. Accepted commands continue processing and reconciling durably.
4. STOPPED updates are explicitly rejected with `RESOURCE_STOPPED_UNSUPPORTED`. The installed ARM model exposes `runningStatus` as read-only, and stopped preservation has not been demonstrated for this implementation. Enable such support only after environment-specific proof and an adapter implementation that keeps the app stopped throughout. Never simulate support by starting then stopping it.
5. Monitor overdue reconciliation alerts (default one hour, configurable with `DEPLOYMENT_RESOURCE_UPDATE_RECONCILIATION_ALERT_MS`, minimum one minute). Inspect the stored operation ID/target revision alongside Azure operation history and the serving revision. Restore a stable baseline or resolve the command through an evidence-based recovery procedure. Do not manually clear a pointer while an earlier PATCH might still run.
6. Drain or resolve all unfinished commands before removing guards, rolling back to older API replicas, or running the down migration. The down migration rejects unfinished commands. A failed rollout may leave an unsettled template; subsequent update/redeploy admission stays blocked until operators restore a stable ready baseline.

The frontend sends the baseline `configuration_version` and a retry-stable idempotency key from an authenticated Next.js server action. Save closes the modal immediately. A card-level controller owns the submission, persisted receipt and sequential polling independently of the form. The original Edit button shows Submitting, Updating or Verifying while the rest of the page stays usable. Errors and status-check retries appear beside that button; an uncertain submission can retry only its original key/version/settings. A definitive rejection retains the draft for reopening. Verified completion refreshes applied values; requested resources are not optimistically presented as applied. Active or uncertain updates remain protected against duplicate commands without keeping a modal open.

The creator is the deployment's persisted owner. Their standard `DeploymentUpdate` grant allows resource editing; Super or role-management privileges are not required. SQL ownership checks run before receipt replay and again during acceptance, so another account cannot update the deployment even with Super. Current subscription and plan limits still apply.

The API no longer emits `RESOURCE_UPDATES_DISABLED`. STOPPED deployments and reads without a verified version cannot submit changes.

## Validation status

An isolated browser check with a delayed mock backend verifies that Save immediately removes the dialog, Submitting appears on the original Edit button, and another page control stays usable. Polling completes after the form unmounts and refreshes applied values. Reloading an unconfirmed submission preserves its request; retry uses the same idempotency key. A definitive 412 stays on the card and restores the draft when the editor is reopened. These checks send no Azure writes.

The API and web production builds pass (`npm run build:api` and `npm run build --workspace @kumo/web -- --webpack`); both web and test TypeScript checks pass. The independently authored resource domain, admission, worker, Azure adapter and HTTP tests pass (20/20); together with the existing feature-flag tests, the focused suite passes 24/24. A read-only check against an existing healthy Container App in `ScaledToZero` reproduced the missing version before the readiness fix and returned a verified baseline and non-null configuration version after it. The separate SQL Server integration test was not run because no `TEST_SQLSERVER_*` database is configured. No tests were authored or modified as part of the implementation task, and no application database migration or live Azure/Stripe mutation was executed.
