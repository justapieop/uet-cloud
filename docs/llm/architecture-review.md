# Architecture review — 2026-10-22

## Assessment

The current backend boundaries are appropriate for the implemented PaaS. Keep the modular monolith and existing domain model. `apps/api` delegates bootstrap to presentation; domain and application source do not import NestJS, Azure SDKs, infrastructure, or presentation. Infrastructure implements application ports, while presentation constructs SDK clients and wires use cases. Transactions belong to the application UnitOfWork, and cloud calls run outside them.

The web client uses Next.js with Feature-Sliced Design and a generated `@kumo/rest` client. Its server API bridge forwards the request cookie rather than importing backend adapters. This review inspected those boundaries; it did not modify UI code or validate the frontend build. The brief's “frontend framework undecided” wording predates the checked-in Next.js implementation and needs a product documentation decision.

## Refactoring performed

- Extracted `AzureContainerLifecycleManager` from `AzureProvider`. Start/stop now require only the Azure lifecycle client and operation timeout. They no longer take build use cases or resource/environment provisioning clients. `AzureProvider` retains the established resource preparation → build → app creation flow.
- Consolidated workload resource-group isolation and exact Container App ARM identity validation in infrastructure's `azure/workload-scope.ts`. Configuration and metrics readers use the same subscription/user/group/app boundary; configuration reads additionally retain their returned deployment-tag check. Adapter-specific errors remain intact.
- Applied `DeploymentUpdate` authorization to start/stop HTTP routes. Previously those handlers required a session and ownership but omitted permission enforcement. Super still works; a read-only role cannot mutate workloads. No new permission bits were allocated.
- Simplified lifecycle test fixtures to provide only start/stop operations; extended existing HTTP permission coverage to prove rejection occurs before use-case execution.

The original lifecycle extraction did not require domain schema, migration, API-path, or queue changes. The deletion follow-up below adds a separate durable workflow.

## Deployment deletion follow-up — 2026-11-05

`DELETE /deployments/:id` now records an owner-scoped request with DeploymentDelete and DeploymentRead, invalidates the owner's cache, and returns HTTP 202. `DeleteDeploymentCase` conditionally changes an eligible row to `DELETE_PENDING` while sharing the SQL operation lease used by volume attach/detach. Worker claims arbitrate against provisioning claims through atomic SQL status updates. Cloud operations remain outside transactions.

`ProcessDeploymentDeletionCase` persists the managed-environment identity before deleting the owned Container App, records confirmed app absence before cleaning app-specific storage links, and retains shared volume data. The app-absence checkpoint releases the deployment slot independently of historical resource IDs or remaining link cleanup. Tombstones preserve IDs and globally unique names; GETs expose deletion snapshots without Azure reads.

The phase 4 review found a missing closing parenthesis in the reservation-count predicate and an unfenced deletion progress update after stale recovery. The quota predicate is corrected. The appended `DeploymentDeletionClaims1793836800000` migration adds a nullable internal UUID token; each deletion claim assigns a new token, recovery/retry clears it, and every deletion worker write matches the current `DELETING` row and token. Lost claims stop without marking the replacement attempt failed. Late provisioning writes now require the row to remain `PROVISIONING`.

Existing migration identities and ordering are preserved. The current status/updated-at queue index is retained; this review did not evaluate production query plans or justify an additional index. Backend compilation passed. Unit, SQL concurrency, migration rollback/reapplication, and live Azure verification are delegated to the separate checking agent.

## Remaining gaps and decisions

1. **Rename before exposure:** `UpdateDeploymentCase` changes the persisted deployment name, while Azure resource access and lifecycle commands use that name as the Container App name. A provisioned app cannot safely be renamed through that use case. Decide whether name is immutable or introduce a separate display name before exposing a rename endpoint.
2. **Lifecycle reconciliation:** start/stop perform an Azure operation followed by a SQL status update. A process crash between them can leave persisted status stale, and simultaneous lifecycle requests are not serialized. A durable command/reconciliation design is a follow-up, not a guarantee provided by this extraction.
3. **Provisioning recovery:** workers intentionally fail stale work instead of automatically resubmitting builds. Moving orchestration into a new service or retrying whole workflows would change that policy and needs a separate recovery design. Keep the existing SQL queues and admission receipts until then.
4. **Optional legacy build path:** `AcrModule`/`AcrProvider` remain available but the active deployment path uses Azure Pipelines. Removing that optional adapter is a product decision, not required to untangle current runtime dependencies.
5. **Cloud reconciliation:** claim tokens prevent obsolete deletion workers from overwriting SQL, but cannot revoke ARM operations already accepted by Azure. Stale recovery can overlap retry-safe cloud cleanup. There is no general scan/reconciler for externally modified resources or late provisioning after a timeout. `DELETE_FAILED` uses an explicit client retry, while only interrupted `DELETING` work is automatically requeued.

## Validation

`npm run test:api` compiles the backend, type-checks test sources, and runs the Node backend and Python pipeline suites. `npm run test:db` checks migrations and concurrency against a dedicated SQL Server instance. Only backend compilation was run for phase 4, at the user's request to delegate test work. The deletion follow-up changes SQL statements and appends migrations, so successful compilation alone does not establish transactional behavior or live Azure correctness. See [deletion recovery](../deployment-configuration.md#deletion-recovery-and-persistence) for the runtime contract.
