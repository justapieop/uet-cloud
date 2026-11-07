# Resource update implementation validation

Date: 2026-11-08. Branch: `k-branch`. Implementation starts after `c6cba75`.

The implementation agent did not author, edit, stage or commit repository tests. Independent tests appeared concurrently in the working tree and remain untracked for their author to manage.

## Build and static checks

- `npm run build:api`: passed.
- `npm run typecheck:tests`: passed after the independent test author corrected invalid typed `for...of` syntax.
- `npx tsc -p packages/rest/tsconfig.json`: passed.
- `git diff --check`: passed.
- REST schema was regenerated from the real Nest controller/Swagger metadata, using an isolated documentation module without SQL/cloud/worker startup. No generated types were edited manually.

## Independent behavioral execution

The supplied test fixtures define a test-owned ABI rather than the actual exported constructor, repository and method contracts. Temporary copies under `/tmp` were emitted to JavaScript and given binding-only adapters; the original repository test files and assertions were unchanged. These results evaluate the corresponding assertions, but do not replace a green run of the original integrated suite.

- Resource configuration/domain plus application admission/processing assertions: **66 passed, 0 failed**. The final application callbacks invalidate owner caches only after successful commit/fenced progress; invalidation failures do not change durable outcomes. Reproduce: `node --test /tmp/kumo-app-independent/packages/{domain,application}/test/deployment-resource-*.test.js`. Log: `/tmp/kumo-app-independent/results.log`.
- Real resource HTTP controller, guards, validation/serialization and production idempotency options: **43 passed, 0 failed**. Reproduce: `node --test /tmp/kumo-resource-http-eval/packages/presentation/test/deployment-resources-http.test.js`. Log: `/tmp/kumo-resource-http-eval/results-final.log`.
- Existing configuration read/duplicate-name/OpenAPI checks: **10 passed, 0 failed**. Python pipeline checks: **6 passed**.
- Resource read-cache assertions in the original full run passed, including short TTL during PENDING/APPLYING/RECONCILING, terminal TTL, owner generation isolation and bypass directives.

The Azure updater diagnostic harness exposed fixture assumptions requiring correction or agreement: `ScaleTo0` is not a documented ARM `RevisionRunningState`; the installed SDK/REST model uses `Stopped` for the positive zero-replica readiness case. SDK-deserialized objects can contain own `undefined` fields that are absent on the serialized wire. A no-op target progress checkpoint is not an ARM submission. Concrete STOPPED support remains deliberately unavailable without live preservation proof. The positive SDK readiness allowlist was retained; no production branch was added to accommodate these assumptions. A diagnostic pass count depending on unsupported fixture states is not considered final verification. SDK payload inspection confirmed preservation on the serialized PATCH, but cannot prove live Azure behavior.

## Original suite remains non-green

The last unadapted `npm run test:api` run completed build/type-check and reported **492 tests: 380 passed, 112 failed**. Log: `/tmp/kumo-resource-update-final-tests.log`.

Observed failure groups include test-owned ABI mismatches (positional versus object exec inputs, UoW and queue property names, updater methods and constructor dependencies), domain command fixtures missing the actual required baseline/receipt fields, existing redeploy/webhook fixtures without the new live reader/pre-PATCH quota dependencies, repository fakes without guarded update/insert methods, and a parameter-property TypeScript fixture unsupported by Node's strip-only test execution. The integrated suite must still be adapted by its author and rerun; these groups do not establish that every outstanding failure is harmless.

Useful public bindings for that follow-up:

- Accept: `UpdateDeploymentResourcesCase(uow, subscriptions, updater, lock, isEnabled, onStateChanged?)`; `exec(id, userId, key, ifMatch, requested)`.
- Query: `GetDeploymentResourceUpdateCase(uow)`; `exec(deploymentId, operationId, userId)` and fresh `assertOwner(deploymentId, userId)` for pre-replay guards.
- Processor: `ProcessDeploymentResourceUpdateCase(uow, subscriptions, updater, lock, queue, onStateChanged?)`; `exec(claimedUpdate, abortSignal?)`. Claimed RECONCILING commands use `updater.reconcile`, without another write.
- UoW property: `deploymentResourceUpdates`; queue methods: `claimNext`, `heartbeat`, `updateClaimed`, `recoverStaleClaims`.
- Azure: `AzureDeploymentConfigurationReader(config, apps, revisions)` and `AzureDeploymentConfigurationUpdater(config, apps, revisions, reader)`; methods `readBaseline`, `update`, `reconcile`.
- Worker: `DeploymentResourceUpdateWorker(queue, processCase, config, invalidateOwner?)`.

## External verification still required

No `TEST_SQLSERVER_*` configuration was available. Dedicated SQL integration/concurrency/rollback tests were not executed, and the application database was not used. No live Azure or Stripe mutation, migration, deployment or remote Git push was performed.

`DeploymentResourceUpdates` remains disabled by default. All replicas must receive migration/guards before admission is enabled. STOPPED admission remains rejected until environment-specific preservation is proven and supported by the adapter. See `../deployment-resource-updates.md` for rollout and uncertain-outcome recovery.
