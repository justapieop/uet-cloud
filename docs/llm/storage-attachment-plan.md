# Storage attachment plan

Draft dated 2026-10-25. This document proposes a backend implementation; it does not change confirmed requirements or provision Azure resources. API names, quota scope, authentication mode, and retention policy below remain proposals until accepted. No live Azure capabilities, billing configuration, or subscription permissions were verified.

## Recommended first release

Provide persistent, user-owned Azure Files volumes that users can attach to an existing Kumo deployment at an absolute container path, such as `/data`. Separate allocation, attachment, detachment, and deletion. Detaching a volume preserves its files. Restarting, scaling to zero, and rebuilding an app must not delete its storage.

Start with classic Azure Files SMB shares, one share per logical volume, in a storage account dedicated to each user and workload region. Create the account in `user-rg-<userId>`, outside Azure's platform-managed `ME_` group. Keep the public contract independent of Azure resource names and credentials. First release supports read/write mounts on the deployment's existing main container, one deployment attachment per volume, and multiple distinct volumes per deployment up to an explicitly configured product limit. Defer cross-deployment sharing, NFS, externally supplied shares, arbitrary mount options, subpaths, snapshots/restore APIs, and shrinking volumes.

Azure Container Apps supports Azure Files persistence through environment storage definitions and app revision volume mounts. Use classic shares under `Microsoft.Storage/storageAccounts/fileServices/shares`, not the newer `Microsoft.FileShares` resource type. [Azure storage mount support](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).

## Repository constraints

- `DeploymentSpec` is durable creation input, and provisioned GETs read applied configuration through an application port. Keep original creation requests unchanged when attaching storage later; introduce separate desired/applied attachment state.
- `Plan.disk` exists and validates a positive integer, but its units and enforcement scope are not established. Storage is explicitly deferred from deployment creation to the allocation flow.
- The existing SQL-backed workers, UnitOfWork, owner-scoped repositories, admission receipts, fresh permissions, and safe error handling provide patterns to reuse.
- `AzureProvider.createDeployment()` returns an existing app without updating it. It cannot serve as an attachment updater. Its current create envelope also omits volumes; passing that envelope over an existing app would risk losing configuration.
- Start/stop currently operate outside a durable deployment-command queue and are not serialized with other mutations. Storage attachment needs coordination with these operations.
- New user environments already have a VNet and delegated subnet. Existing environments may lack custom networking and must not be recreated automatically.
- The installed `@azure/arm-appcontainers` model exposes account-key and Key Vault reference properties for Azure Files, but not the managed-identity property documented in the new mount preview. A TypeScript cast alone would not make its serializer send that property.

## Phase 1: prove Azure compatibility and settle product choices

Build a small isolated Azure proof before implementing the public API. Validate account/share provisioning, mount authentication, private network reachability, container filesystem permissions, revision activation, detach/re-attach, persistence after restart, and behavior when a share is full. Use disposable test data and record the resource/API versions tested.

Preferred authentication is the environment's managed identity, with storage-account access scoped to that user's account. Microsoft currently labels this SMB authentication flow preview. It requires the storage account's SMB OAuth configuration and appropriate environment-identity role assignment. The storage definition must select that identity explicitly. Validate subscription/region support and an SDK/API version that actually serializes the fields before adopting it. [Managed-identity mount tutorial](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files).

If preview use is unsuitable, make an explicit implementation decision to use the supported Key Vault-backed account-key mode. Keys remain server-managed and absent from SQL, DTOs, app environment variables, logs, and idempotency receipts. Document key rotation and test mounts after rotation. Never silently fall back to account keys after an identity failure, and never reuse the platform ACR pull identity for storage.

Prefer storage access restricted to the existing user VNet. In the proof, compare a storage service-endpoint configuration with a private endpoint plus DNS; record compatibility and costs before choosing. A private endpoint needs its own subnet, not the delegated ACA infrastructure subnet. Preserve the existing `/24` infrastructure subnet and its address range. Existing non-VNet environments need a documented compatible path or a migration prerequisite; no automatic replacement.

Proposed quota policy: define `Plan.disk` in GiB as a total allocated-storage budget per user, including detached volumes. This is a proposal, not an interpretation already settled by the brief's reference to storage on an instance. Confirm aggregate-per-user versus per-deployment limits before implementing enforcement. Detached retained data must not become unaccounted storage under either choice.

For small plan allocations, evaluate a pay-as-you-go share: its quota is a size limit, whereas provisioned billing models treat quota as purchased capacity. Confirm supported minimum sizes and practical full-share behavior in the chosen SKU. Do not equate reserved quota with actual used bytes or implement overage billing from reserved GiB. [Azure share quota semantics](https://learn.microsoft.com/en-us/azure/storage/files/modify-file-share).

## Phase 2: domain, persistence, and admission

Add domain definitions following the existing `Domain<TDetails>` constructor and validation conventions:

- `Volume`: ID, owner ID, display name, size in GiB, fixed workload region, workflow status, timestamps, and safe failure information. Azure identifiers belong in infrastructure persistence/projections rather than client input.
- `VolumeAttachment`: ID, volume ID, deployment ID, owner ID, main-container identity, normalized mount path, desired state, applied revision reference, operation ID, and version.
- `StorageOperation`: durable create/attach/detach/delete command, fingerprint, request owner, progress/checkpoints, lease/version, and outcome. A separate persisted account mapping tracks deterministic storage-account naming and provisioning progress.

Use distinct states: volume `PENDING`, `PROVISIONING`, `READY`, `DELETING`, `FAILED`, `DELETED`; attachment `ATTACHING`, `ATTACHED`, `DETACHING`, `FAILED`. Keep these separate from deployment `RUNNING`/`STOPPED`: a failed attachment must not misreport an otherwise healthy app as failed.

Append migrations and their registration to `packages/infrastructure/src/db/migrations.ts`; preserve historical names/order. Add owner-scoped volume/attachment/operation repositories to the application UnitOfWork. Use SQL constraints for duplicate active attachments and mount-path claims; reject overlapping paths such as `/data` and `/data/cache`, not merely exact duplicates.

For paid allocation, verify current active Stripe subscriptions outside the UoW. Inside the UoW, lock the user with `findByIdForUpdate()`, recheck eligibility and the customer association, load eligible local plans, count allocated reservations in SQL, and persist volume reservation + durable operation + acceptance receipt atomically. Follow the existing no-stacked-plan rule. Under the proposed aggregate budget, one eligible plan must cover the full post-allocation total. Replay an accepted retry without a new Stripe request or allocation, after fresh authentication/suspension checks.

Reserve storage during pending/provisioning work. Retain the reservation while a share exists, while deletion is uncertain, and while data is detached but retained. Release a failed reservation only after proving no billable share remains, and release deletion reservations only after confirmed cleanup. Reject new allocation over quota; do not silently delete data after a plan downgrade or subscription lapse. Decide the retention/grace policy separately, including access to detach/delete actions without an active subscription.

## Phase 3: API contract

Proposed routes, all owner-scoped and requiring active, unsuspended sessions:

| Operation | Route | Result |
| --- | --- | --- |
| Allocate volume | `POST /volumes` | 202 with volume and operation IDs |
| List/read volumes | `GET /volumes`, `GET /volumes/:id` | Configuration and workflow status |
| Attach volume | `POST /deployments/:id/volumes` | 202 with attachment and operation IDs |
| List attachments | `GET /deployments/:id/volumes` | Desired/applied mounts and progress |
| Detach volume | `DELETE /deployments/:id/volumes/:attachmentId` | 202; retained data |
| Delete volume | `DELETE /volumes/:id` | 202; reject attached or referenced volumes |
| Read operation | `GET /storage-operations/:id` | Durable progress and safe error |

Allocation example:

```json
{ "name": "uploads", "size_gib": 10 }
```

Derive region from the user's existing managed environment. For the first release, require that environment to exist; reject allocation before it exists rather than implicitly provisioning a new deployment environment. This intentionally keeps storage outside `POST /deployments`.

Attachment example:

```json
{ "volume_id": "<uuid>", "mount_path": "/data" }
```

No account keys, user IDs, Azure resource IDs, hostnames, arbitrary share names, or mount options are accepted. Validate positive integer GiB, UUIDs, resource ownership, compatible region/environment, supported deployment state, and mount paths. Require normalized absolute Linux paths; reject `/`, traversal, colon/NUL, system paths, duplicate/overlapping mounts, and excessive path lengths. Document that mounting over an existing directory hides its image-provided contents. Cross-user references return 404 before any cloud lookup.

Require `Idempotency-Key` on mutations. Back every accepted command with an atomic SQL business receipt, not only the HTTP response store; changed requests under the same key fail. Return sanitized 400/403/404/409/422/503 errors using existing conventions. Mutations invalidate that user's affected deployment/volume cache generations; first-release volume reads can remain uncached with `private, no-store`.

Propose new stable `StorageRead` and `StorageManage` permission definitions at the next unused offsets; confirm the catalog immediately before implementation. Do not renumber existing bits or grant new permissions to ordinary existing roles automatically. Attachment mutations also require `DeploymentUpdate`, and attachment reads require `DeploymentRead`. List every required bit explicitly because prerequisite metadata is not enforced. Super still does not bypass ownership or quota checks.

## Phase 4: durable Azure operations and revision rollout

Add infrastructure adapters for account/share provisioning, environment storage definitions, app mount configuration, and cleanup; supply SDK clients/credentials/transports through presentation factories. Keep Azure models out of domain/application. Put new external dependencies in the root package manifest. No cloud waits occur in database transactions.

Storage accounts need globally unique lowercase names of Azure-compatible length; derive a stable name from the persisted user/region mapping and handle collisions explicitly. Share names and environment storage aliases derive from volume IDs, not user display names. Verify subscription, owner RG, environment, and resource identity before every read/write/delete. Do not write tenant data into the platform RG or the `ME_` group.

Workflow for attaching:

1. Claim the durable command and acquire a per-deployment mutation lease/version. Coordinate provisioning, start/stop, attachment updates, and future redeploy/delete commands; return conflict for incompatible concurrent work.
2. Validate the share/account and create or verify the environment storage definition. Persist each completed step and its identity. Serialize shared per-user account/identity initialization as well as per-deployment app mutations.
3. Read the current applied app configuration. Merge the new volume and main-container mount into the existing template without dropping image, resources, ingress visibility, additional ports, ACR identity, secrets, environment variables, scaling, or existing volumes. Preserve the same image; attaching must not trigger a source rebuild.
4. Submit a deterministic new revision and wait for readiness/activation. Persist its identity before marking the attachment `ATTACHED`. Treat Azure provisioning success and mount/application readiness as separate checks.
5. If the response is lost or the worker crashes, inspect Azure using the saved command/revision identifiers before continuing. Do not blindly resubmit an entire deployment or switch images. On a failed rollout, retain the previous usable revision and the volume, expose the failed operation, and reconcile uncertain state.

Use conditional resource updates if the chosen ACA API supports them. A SQL lease alone cannot fence a stale process's Azure write; otherwise retain explicit reconciliation and avoid claiming atomic cross-cloud guarantees. Do not resume nonterminal storage mutations without a durable recovery design. This is a new storage-command guarantee, not a change to the existing fail-stale build queue policy.

An attachment references a network file share: every app replica sees the same files. This does not provide exclusive block storage or make an arbitrary database filesystem-safe. Revision transitions may briefly run old/new writers even with one configured replica. Document application coordination requirements, and provide a quiesced maintenance rollout path where concurrent writers are unsafe. Attach to initially `RUNNING` apps in the first release; explicitly defer stopped-app mount changes until their desired/applied lifecycle is designed.

## Phase 5: detachment, cleanup, and operational visibility

Detach by rolling out a revision without the mount, then retire old revisions that reference it. A mount hidden in an inactive revision is still a deletion dependency because that revision might be reactivated. Verify there are no active, inactive/reactivatable, desired, or in-flight references before deleting the environment storage definition and share. Block deletion until references are safely cleared; never force-delete through an attachment.

Do not automatically delete storage when a deployment stops, fails, is removed, or loses billing eligibility. The existing SQL-only deployment deletion use case is not a safe cloud cleanup workflow; coordinate it before exposing public deployment deletion. Volume deletion is an explicit destructive action with a product-visible retained-data/backup policy. Soft-delete and recovery retention, if adopted, must have a defined billing/quota treatment.

Expose requested size, applied share quota, attachment/revision status, and safe errors separately. Azure applied mount reads belong behind a reader port; do not overwrite SQL desired state with cloud observations. Report allocated GiB and measured usage distinctly. Add fixed-name operation logs, stale/failed-operation alerts, orphan reconciliation, and an operator procedure for uncertain resources. Do not publish Stripe usage events or promise backups without separately implementing those features.

## Implementation order and acceptance gates

1. Azure proof, authentication/SDK decision, network path, quota units/scope, and retention decision.
2. Domain/ports, additive migrations, reservation accounting, and durable receipt/operation repositories.
3. Owner-scoped list/read/allocation API and provisioning worker.
4. Deployment mutation coordination, revision-aware attach/detach, applied reads, and cache invalidation.
5. Safe deletion/reference accounting, reconciliation, operator documentation, and rollout behind a disabled-by-default feature flag.
6. OpenAPI DTOs/status/security and regenerated `packages/rest/src/schema.ts` from the resulting API document. Leave frontend implementation for a separate task.

Validation must cover strict cross-user rejection, same-key retries after crashes, full-share behavior, requested/applied separation, restart persistence, denied/expired billing, failed role grants, malformed mounts, concurrent last-GiB reservations, attach/delete and lifecycle races, secret redaction, SDK request serialization, preserved ingress/resources/image, failed revision rollback, old revision references, and resources left after uncertain failures. Use `npm run test:api` for normal checks and `npm run test:db` with dedicated SQL settings for locking/claim/rollback assertions. A live Azure test must prove persistence, identity/network access, rollout readiness, and safe cleanup before enabling the feature.

No runtime code, migrations, billing rules, or `.env` changes are part of this draft.
