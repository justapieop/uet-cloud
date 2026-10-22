# Architecture review — 2026-10-22

## Assessment

The current backend boundaries are appropriate for the implemented PaaS. Keep the modular monolith and existing domain model. `apps/api` delegates bootstrap to presentation; domain and application source do not import NestJS, Azure SDKs, infrastructure, or presentation. Infrastructure implements application ports, while presentation constructs SDK clients and wires use cases. Transactions belong to the application UnitOfWork, and cloud calls run outside them.

The web client uses Next.js with Feature-Sliced Design and a generated `@kumo/rest` client. Its server API bridge forwards the request cookie rather than importing backend adapters. This review inspected those boundaries; it did not modify UI code or validate the frontend build. The brief's “frontend framework undecided” wording predates the checked-in Next.js implementation and needs a product documentation decision.

## Refactoring performed

- Extracted `AzureContainerLifecycleManager` from `AzureProvider`. Start/stop now require only the Azure lifecycle client and operation timeout. They no longer take build use cases or resource/environment provisioning clients. `AzureProvider` retains the established resource preparation → build → app creation flow.
- Consolidated workload resource-group isolation and exact Container App ARM identity validation in infrastructure's `azure/workload-scope.ts`. Configuration and metrics readers use the same subscription/user/group/app boundary; configuration reads additionally retain their returned deployment-tag check. Adapter-specific errors remain intact.
- Applied `DeploymentUpdate` authorization to start/stop HTTP routes. Previously those handlers required a session and ownership but omitted permission enforcement. Super still works; a read-only role cannot mutate workloads. No new permission bits were allocated.
- Simplified lifecycle test fixtures to provide only start/stop operations; extended existing HTTP permission coverage to prove rejection occurs before use-case execution.

No domain schema, migrations, deployment names, API paths, queue semantics, admission quotas, subscription registration, or session persistence changes were needed.

## Remaining gaps and decisions

1. **Rename before exposure:** `UpdateDeploymentCase` changes the persisted deployment name, while Azure resource access and lifecycle commands use that name as the Container App name. A provisioned app cannot safely be renamed through that use case. Decide whether name is immutable or introduce a separate display name before exposing a rename endpoint.
2. **Deletion before exposure:** `DeleteDeploymentCase` deletes only the SQL record. It does not remove the Azure app, coordinate in-flight provisioning, or retain cleanup progress. A public delete endpoint needs a durable deletion workflow before it can call this case safely.
3. **Lifecycle reconciliation:** start/stop perform an Azure operation followed by a SQL status update. A process crash between them can leave persisted status stale, and simultaneous lifecycle requests are not serialized. A durable command/reconciliation design is a follow-up, not a guarantee provided by this extraction.
4. **Provisioning recovery:** workers intentionally fail stale work instead of automatically resubmitting builds. Moving orchestration into a new service or retrying whole workflows would change that policy and needs a separate recovery design. Keep the existing SQL queues and admission receipts until then.
5. **Optional legacy build path:** `AcrModule`/`AcrProvider` remain available but the active deployment path uses Azure Pipelines. Removing that optional adapter is a product decision, not required to untangle current runtime dependencies.

The rename/delete gaps are existing application behavior with no HTTP handlers. This review records them without inventing cloud deletion or resource migration semantics.

## Validation

`npm run test:api` compiles the backend, type-checks test sources, and runs the Node backend and Python pipeline suites. Real SQL integration and live Azure behavior require their dedicated environments; this refactor changes neither SQL statements nor migrations.
