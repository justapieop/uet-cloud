# Azure deployment plan

Draft dated 2026-10-24. This is a proposed deployment design, not an implemented deployment or a change to confirmed product requirements. No Azure account, existing cloud resources, subscription permissions, or live quotas were inspected.

## Recommendation

Use Azure Container Apps for the Next.js frontend and NestJS API, Bicep for infrastructure, and a PowerShell bootstrap command for setup. Extend the existing GitHub Actions checks with a platform release workflow authenticated through OIDC. Retain Azure Pipelines for builds of applications submitted by Kumo users.

Target experience: sign in, supply one environment parameter file and the external credentials, run one bootstrap command, and then deploy application updates by pushing to the chosen release branch. Aim for **zero Azure Portal resource-creation steps**, subject to the operator already having the required permissions. Account creation, MFA, repository consent, and payment-provider activation remain interactive when required by those services.

The platform release pipeline and the tenant application build pipeline are separate. The existing `infra/azure/pipelines/build.yml` builds user Dockerfiles; it does not build or deploy Kumo itself.

## Repository findings that determine this plan

| Finding | Deployment consequence |
| --- | --- |
| npm workspaces; `apps/api` delegates to `packages/presentation` | Build the API from the repository root and retain workspace package manifests, compiled outputs, and runtime dependency links in its image. |
| `apps/web` uses Next.js 16, server components, server actions, and `headers()` | Deploy a Node.js server image. A static export cannot serve the existing app. The brief still describes the frontend framework as undecided; record that discrepancy without treating this draft as a product decision. |
| No platform Dockerfiles, Bicep, or platform release workflow | Create the deployment packaging and automation; there is no existing one-command deployment to invoke. |
| Both durable queue workers run in the API process | API minimum replicas must be one. HTTP scale-to-zero would leave queued work waiting indefinitely without another request. Start at one maximum replica too, until rollout and migration behavior are validated. |
| SQL Server through TypeORM with Entra default credentials | Use Azure SQL Database, provision a contained database principal, and configure identity selection. Azure RBAC alone does not give SQL data access. |
| `migrationsRun: true` at API startup | First boot requires schema permissions. Production releases should move migrations to one explicit maintenance job before API startup. |
| `connect-mongo` stores sessions, while Redis already backs the response cache | The unchanged application needs both a Mongo-compatible service and Redis. Reusing Redis for sessions is an optional simplification described below. |
| Production cookies are Secure, HttpOnly, SameSite=Lax, with no Domain | Frontend and login callback need one browser origin, or an explicit alternative session design. Separate default ACA hostnames will not share the cookie. |
| Bootstrap has no explicit proxy trust configuration | Test and configure the trusted ingress chain so HTTPS cookies work after ACA terminates TLS. |
| `API_URL` currently serves both server requests and browser redirects/installation links | Split private API connectivity from its public URL before using internal-only API ingress. |
| App Configuration loads settings and Key Vault references at startup | Provision settings, references, identity roles, and external credentials before starting the API. Ordinary configuration changes require a restart. |
| GitHub App JWTs are signed through Key Vault Keys | Import the GitHub-issued matching private key into Keys. A newly generated unrelated vault key, or a PEM stored only as a Secret, will not work. |
| API calls Azure DevOps through DefaultAzureCredential | Add the API identity to the DevOps organization and pipeline permissions explicitly; Azure subscription permissions do not cover this. |
| Azure Pipelines downloads manifests/source from Kumo | Keep a public HTTPS route to those bearer-protected endpoints even when the API app has internal ingress. |
| Workload RGs are created dynamically at subscription scope | Runtime needs narrowly defined subscription-scope provisioning permissions. Granting access only to the platform RG cannot support the current provider. |
| Interrupted work is failed rather than resumed automatically | Releases need draining; changing ACA revisions alone does not make hour-long orchestration restart-safe. |
| Plans, roles, and Stripe eligibility are separate checks | Successful hosting is insufficient for a working deployment demo: bootstrap roles, map real products to plans, and obtain an active subscription. |

Evidence: `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `packages/presentation/src/bootstrap.ts`, presentation modules, infrastructure config/auth/Azure/SQL adapters, application deployment/build/billing use cases, the frontend API bridge and server actions, database scripts, existing CI/pipeline definitions, and supporting documentation/tests. Installed Next.js deployment, standalone-output, and self-hosting guides were also consulted. Existing docs contain stale descriptions of sessions, deployment wiring, and uniqueness; use current code and project instructions when implementing this plan.

## Proposed topology

```text
Browser / Azure Pipelines hosted agents
                   |
                   | HTTPS
                   v
  Public gateway Container App (small Nginx image)
       /api/* -> API; strip /api before forwarding
       /*     -> Next.js frontend
                   |
       Platform ACA Workload Profiles environment
          +-- web: internal ingress, Node.js
          +-- api: internal ingress, Node.js, min=1
                   +-- Azure SQL Database
                   +-- Azure Managed Redis
                   +-- Mongo-compatible sessions, if retained
                   +-- App Configuration -> Key Vault Secrets
                   +-- Key Vault Keys: GitHub signing
                   +-- GitHub / Stripe / Azure DevOps / ARM

  Tenant application build pipeline -> tenant ACR
  API -> user-rg-<GitHub ID> -> user-aca-env-<ID> -> user apps
```

Use the gateway's generated ACA HTTPS hostname for the first release. A custom domain and its certificate can be added later through CLI/Bicep and the DNS provider API. This avoids making DNS ownership or propagation a prerequisite for the first working deployment. Nginx is a proposed gateway, not an existing repository component; its small additional image avoids introducing Front Door solely for path routing. Front Door remains an option if global routing/WAF is later required.

Keep platform services in their own managed environment. User code continues in the per-user environments already created by the provider; do not place user workloads in the platform environment.

Use **two private registries**: one for trusted platform images and one for tenant images. User-selected image names currently share a tenant registry namespace, so storing platform images there could allow a submitted build to overwrite a platform repository. Disable anonymous pull and registry admin credentials on both registries. Separate push/pull identities by registry.

### Browser routing and cookies

1. Keep Next.js routes `/plans`, `/admin`, `/dashboard`, and `/auth/login` intact. Proxy API paths exclusively under `/api/` to avoid collisions with frontend paths such as `/plans`.
2. Keep `API_URL` as a server-only internal API base. Add a separately named public API base, for example `PUBLIC_API_URL=https://<gateway>/api`, for the login redirect and GitHub installation link. Do not derive these from an untrusted incoming Host header.
3. Set `GITHUB_OAUTH2_REDIRECT_URL=https://<gateway>/api/auth/callback` and `FRONTEND_URL=https://<gateway>`. The session cookie must use Path=/ so Next.js receives it on dashboard requests.
4. Preserve Cookie, Set-Cookie, Authorization, query strings, and redirects. Preserve the external authority where appropriate and deliberately set trusted forwarding headers. Ensure secure-cookie detection survives the gateway and internal ingress hops; do not blindly trust forwarded headers from arbitrary callers.
5. Verify Next.js server-action Origin/Host handling through the gateway. Preserve Nest's existing CSRF protection; configure only the exact public origin if the internal Host prevents valid browser requests. Existing server actions forward cookies without browser Origin headers, so test those independently too.
6. Disable proxy caching for authenticated pages, mutations, auth routes, and build source. Stream source archives and Next.js responses; configure response timeouts for source preparation/download and avoid an unnecessary small proxy buffering limit.
7. Set pipeline `kumoApiUrl=https://<gateway>/api`. The existing Python downloader appends `/builds/...` to that base, which the gateway forwards to the unchanged API routes.

### Session-store choice

**Baseline, preserving current application behavior:** retain Mongo sessions. Accept an existing compatible managed Mongo endpoint, or provision an Azure Mongo-compatible service after testing the actual `connect-mongo` commands, expiry index, cleanup, touch behavior, and TLS settings. Do not assume Cosmos DB's Mongo compatibility makes every MongoDB session/index feature interchangeable. Provide its connection string through a Key Vault reference named `MONGODB_CONNECTION_STRING`.

**Recommended simplification, requiring a small application change:** replace `connect-mongo` with a supported Redis session store. Reuse Azure Managed Redis with separate session/cache prefixes and explicit TTLs. Remove the Mongo dependency only after session persistence/logout/expiry tests pass. Existing sessions need either a migration or a documented sign-in reset. With sessions and disposable cache in one instance, use a deliberate memory/eviction policy and headroom; cache pressure must not silently evict sessions. Cache outages may bypass response caching, but session failures must fail authentication closed.

For Azure Managed Redis, verify the current Keyv adapter and optional session client's topology support. Select a compatible Enterprise or Non-clustered policy rather than assuming the current plain URL configuration supports OSS clustering. Use TLS and the service-reported port. Initially the existing URL-based adapter can use an access key kept in Key Vault; Entra Redis authentication requires client token-refresh integration, not merely an Azure role assignment. Prefer Azure Managed Redis for new infrastructure given Azure Cache for Redis's retirement direction. [Architecture](https://learn.microsoft.com/en-us/azure/redis/architecture), [retirement guidance](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq).

## Infrastructure and identities

Create subscription-scoped Bicep for the platform RG, provider registrations where authorized, and runtime custom roles; use modules for resource-scoped deployment. Proposed resources:

- VNet with the delegated ACA subnet and separate private-endpoint subnet; private DNS for data services.
- Standard Workload Profiles ACA environment with Consumption, plus Log Analytics.
- Gateway, web, API, and manually invoked database maintenance jobs. Start gateway/web/API at min=1 and max=1 for predictable launch behavior; size from measured startup/source-archive memory rather than promising a fixed smallest SKU will fit.
- Azure SQL logical server, database, Entra administrator configuration, private endpoint, and backups.
- Azure Managed Redis and private connectivity. Mongo service/private connectivity only if sessions are retained.
- App Configuration, Key Vault with RBAC, two ACRs, user-assigned identities, scoped role assignments, alerts, and a subscription budget.

Keep SQL and Redis private. Maintenance jobs run in the platform network, so GitHub-hosted runners need not connect directly to private databases. App Configuration/Key Vault may initially use their public TLS endpoints with identity-based access; make their private endpoints an environment option. Keep tenant ACR reachable by existing hosted build agents and user environments; anonymous access remains disabled. A private-only tenant registry would require changes to build-agent networking and every user's environment, which the current provider does not provision.

| Identity | Required access |
| --- | --- |
| Bootstrap operator | Resource creation, role assignment/custom-role creation, Entra SQL administration, DevOps administration, and repository setup permissions, as applicable. Check each rather than assuming Contributor can assign roles. |
| Platform release identity | GitHub OIDC restricted to the intended repository/branch or environment; platform ACR push, platform app/job updates, and approved infrastructure changes. Bootstrap owns elevated subscription/RBAC setup; do not give routine releases Owner. |
| API runtime identity | App Configuration Data Reader; Key Vault Secrets User; scoped Key Vault signing permission; SQL runtime user; tenant ACR resource read; Managed Identity Operator on the tenant pull identity; required ARM provisioning/lifecycle/metrics permissions; explicit DevOps organization/pipeline access. |
| Database migration identity | SQL migration/schema permissions and only the secrets/config needed by maintenance jobs; no API workers. |
| Platform image pull identity | AcrPull on the platform registry; unavailable to app code where supported. |
| Tenant build push identity | Federated DevOps ARM service connection, AcrPush on the tenant registry, no platform registry or infrastructure modification access. |
| Tenant image pull identity | AcrPull on the tenant registry only, attached with lifecycle None as the provider already specifies. Never attach the API runtime identity to user apps. |

Use traditional ACR RBAC initially so `AcrPush`/`AcrPull` match the intended permissions; an ABAC registry needs different repository roles. [Managed identity image pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).

The API's custom ARM role must cover the exact RG, managed-environment, container-app, operation-status, and metrics calls found in the active adapters; exclude role-assignment writes and unrelated resource types. Dynamic RG creation requires subscription scope under the current implementation. Code checks against the central RG are not an Azure authorization boundary: the platform and tenants share one configured subscription. Prefer a dedicated Kumo subscription and document the remaining runtime blast radius. Stronger separation requires a provisioning broker or separate platform/workload subscription configuration; it is a follow-up design, not something to claim is already enforced by RBAC.

Prefer a pre-created API user-assigned identity to resolve startup dependencies. Set `AZURE_CLIENT_ID` on the API process for DefaultAzureCredential; verify SQL's separate Tedious credential chain uses the same identity, passing its client ID explicitly if necessary. Do not use `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` inside deployed containers.

## Implementation sequence

### 1. Make the runtime deployable

- Add root-context multi-stage Dockerfiles for API, web, and gateway; pin the Node 24 image and dependencies through the lockfile. Exclude `.env`, `.git`, local build outputs, and credentials from build contexts. Run unprivileged.
- API: `npm ci`, `npm run build:api`, retain compiled backend packages and their workspace runtime links, and start with `node apps/api/dist/main.js`. Keep writable temporary storage for source archives: source preparation currently handles up to 100 MiB compressed / 256 MiB extracted per request, with additional archive overhead.
- Web: enable standalone output and repository-root output tracing; run `npm run build -w apps/web`. Verify `@kumo/rest` and any traced domain dependencies are included. Copy static/public assets into their actual monorepo standalone locations and bind to `0.0.0.0`. Google fonts are downloaded during the build today; allow that egress or bundle fonts locally.
- Resolve the lockfile's Next.js/native SWC version mismatch (`next` 16.3.8 versus explicitly listed Linux SWC 16.4.0) before relying on Linux images. Test Linux image builds rather than copying Windows `node_modules`.
- Add non-session liveness and readiness endpoints. Readiness should report required configuration/database/session availability with bounded checks; transient GitHub/Stripe/ARM outages must not trigger liveness restart loops. Configure explicit ACA startup/readiness/liveness probes.
- Require production session secrets and store URLs; remove silent production fallbacks to the development secret and localhost Mongo. Confirm the session store has a readiness check instead of relying only on constructing its client.
- Implement/test public/private API URL separation, gateway routing, trusted proxy behavior, and production cookie flow.
- Add an explicit migration switch and standalone migration command. API runs with migrations disabled; the maintenance job runs migrations exactly once per release. Keep seed/admin scripts independent of Nest and workers.
- Add a bounded operational drain mechanism before routine upgrades: block new deployment admission, stop workers taking new claims, and observe active work without restarting the API. Keep build-source routes available while active builds finish. Existing startup-only settings/12-hour feature refresh are insufficient for responsive draining.

### 2. Build Bicep and a resumable bootstrap script

Proposed files:

```text
infra/azure/main.bicep
infra/azure/modules/{network,identities,data,configuration,registries,apps,monitoring}.bicep
infra/azure/environments/{dev,production}.bicepparam
infra/azure/gateway/{Dockerfile,nginx.conf.template}
infra/azure/platform/{api,web}.Dockerfile
scripts/azure/{bootstrap,configure,release,verify,rollback}.ps1
scripts/{migrate-db,bootstrap-sql}.mjs
.github/workflows/platform-release.yml
```

Treat these as proposed files. Use PowerShell 7 for the operator entry point, with Azure CLI/Bicep, GitHub CLI, Docker, Node 24, Python, and any required SQL tools checked up front. Scripts must be idempotent, stop on native-command failures, support checkpoints, and discover existing resources before creating replacements. Write only non-secret resource IDs and checkpoints to a Git-ignored state file. Retry bounded readiness/RBAC propagation checks rather than sleeping for a fixed guess.

Run the bootstrap in dependency order:

1. Validate tenant/subscription, permissions, service availability/SKUs in the selected region, provider registration, naming availability, hosted-agent capacity, and existing-resource ownership. Propose `southeastasia` for the platform initially because it matches current workload defaults, subject to availability; user-selected deployment regions remain per request.
2. Deploy foundation resources and identities without starting the API. Create empty registries and the platform environment; output its default domain. Compute the gateway hostname deterministically from the app name/domain, then verify it against the actual deployed FQDN. Alternatively use a gateway-only placeholder revision while configuration is completed.
3. Build/push trusted platform images using the signed-in bootstrap identity. Do not make first deployment depend on the still-unconfigured tenant build pipeline or on a private image that does not exist yet.
4. Set up external credentials/DevOps as described below. Import secrets directly to Key Vault and the matching GitHub RSA key into Key Vault Keys. Create App Configuration Key Vault references, not plain copies of secrets. Never echo secret outputs or persist them in Bicep parameter files/deployment outputs.
5. Bootstrap SQL users using a separate privileged maintenance job in the VNet. Configure a temporary bootstrap principal/group as Entra SQL administrator; run parameterized, idempotent T-SQL to create migration/runtime users and grants. Where directory lookup would require extra Graph grants, evaluate supported SID-based user creation with the correct principal identifier for that syntax. Verify the API's actual identity can connect. Restore the intended administrator and remove temporary bootstrap access afterward.
6. Run the standalone migration job, then seed roles/plans and explicitly add the known numeric GitHub administrator ID. Existing scripts consume database environment variables directly, not App Configuration; inject database settings and the appropriate job identity explicitly. Adapt the commands/image so `seed:db` and `admin:add` do not try compiling TypeScript in a production-only runtime image; direct execution of their already-compiled script dependencies is sufficient.
7. Deploy API and web internal ingress with explicit ports, identities, configuration, probes, and scale settings. Deploy/update gateway upstream configuration using their internal FQDNs. Wait for required access propagation and healthy revisions.
8. Register exact final callback/return URLs, verify through the gateway, and store the pipeline ID and computed endpoints in configuration. Restart API if a required startup setting changed; no restart is needed merely to discover already-final values.
9. Configure platform GitHub OIDC and repository environment variables through `gh`, using branch/environment subjects consistently. Execute smoke checks and emit a concise resource/URL report.

Never run database seeding against a live API with workers. The first launch does it before API startup; later maintenance must stop API replicas before invoking scripts that require the server stopped.

### 3. Automate external integrations

| Setup | Automatable portion | Possible remaining interaction |
| --- | --- | --- |
| Azure | Resources, RBAC, config, identities, SQL jobs, release | `az login`/MFA and organization administrator grants if the operator lacks authority. |
| GitHub App | Manifest-generated registration form, credential exchange, key import, configuration | Owner confirms app creation and installation/repository grants. Reuse existing app credentials when available. |
| OAuth login | Store supplied client ID/secret and exact callback | Account owner approval/credential creation if not obtainable from the app registration flow. Confirm whether one GitHub App supplies both login and repository access; code also permits separate client IDs. |
| Azure DevOps | Project/pipeline creation via CLI/REST, variables, API identity entitlement, ACLs, federated service connection | Organization creation/tenant association, GitHub repository-connection authorization, agent-capacity approval/purchase, and policy approvals where applicable. |
| Stripe | Products/prices in test mode via API, supplied secret import, local plan mappings | Account creation/activation and approval of live prices/payment configuration. Pricing assumptions in the brief are unresolved; do not turn examples into live charges. |
| DNS | Azure DNS CLI or another provider's API | Domain ownership and registrar delegation where not already automated. Defer for first release. |

For GitHub, a manifest flow can prefill settings and return generated credentials for immediate vault import, but cannot remove the owner's consent. Import the matching private key; leave no PEM in the repository or build context. [GitHub manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest).

For Azure DevOps, script creation of the pipeline from `infra/azure/pipelines/build.yml`, fixed `kumoApiUrl`, `acrServiceConnection`, `acrRegistryName`, and a secret, queue-time-overridable `kumoSourceToken` placeholder. Keep every variable except the per-build token under platform control. Add the API managed identity with the required project access and Queue/View builds/View pipeline permissions through the entitlement/security APIs. Authorize the ACR service connection only for this pipeline. [Identity entitlements](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity?view=azure-devops).

Create the ARM service connection through the current federation workflow and read its issuer/subject from DevOps rather than hardcoding old examples. Microsoft documents a transition away from the legacy DevOps issuer, so automation must use the values returned by the current API. [Federated service connection setup](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity?view=azure-devops).

### 4. Configure runtime values

| Destination | Values |
| --- | --- |
| API process bootstrap | `NODE_ENV=production`, `CONFIG_SOURCE=azure`, `AZURE_APPCONFIG_ENDPOINT`, API runtime identity `AZURE_CLIENT_ID`. |
| App Configuration, production label | `PORT`; SQL host/port/name and encryption; explicit migration switch; `AZURE_SUBSCRIPTION_ID`; `AZURE_PLATFORM_RESOURCE_GROUP`; `AZURE_RG_NAME` where fallback consumers need it; tenant registry server/name/resource ID and pull identity name; DevOps organization/project/pipeline ID; vault name; GitHub App client ID/key name; OAuth client ID/callback URL; `FRONTEND_URL`; timeout/resilience overrides only where justified. |
| Key Vault secrets through App Configuration references | Strong generated `SESSION_SECRET`, OAuth secret, `STRIPE_SECRET_KEY`, `REDIS_CONNECTION_URL`, and `MONGODB_CONNECTION_STRING` if retained. Do not configure a production DevOps PAT when managed identity is used. |
| Web process | Server-only internal `API_URL`; proposed public API URL; `NODE_ENV=production`; port/host. Frontend does not load API App Configuration automatically. |
| Web build | Same Server Actions encryption key for instances of a release, supplied securely at build time if configured; release identifier for version-skew handling. Runtime-only injection does not replace Next's build-time key behavior. |
| Gateway process | Internal upstream addresses, expected public authority, timeouts and explicit forwarding rules. No Azure provisioning credentials. |
| Maintenance jobs | Direct database environment settings, managed identity selection, seed input/admin ID as required. No API bootstrap. |

Keep `DATABASE_ENABLE_ENCRYPTION=true`. Ordinary Azure config/secret updates need an API rollout to load new values. Validate App Configuration's empty-feature-flag startup behavior because `FeatureFlagsService` expects a feature flag snapshot; do not invent an enabled product flag merely to make startup succeed.

### 5. Add automatic platform releases

Trigger on pushes to the chosen release branch after required checks pass, with `workflow_dispatch` for reruns. Use per-environment concurrency so two releases cannot migrate/roll out together. OIDC avoids storing an Azure client secret in GitHub. [GitHub Actions OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

Release sequence:

1. Run the existing `npm run test:api` and isolated `npm run test:db` jobs; add `npm run build -w apps/web` and Linux container smoke checks. Do not run the destructive SQL integration suite against production.
2. Build platform images from the root with the lockfile; push immutable release tags and deploy by digest from the platform registry. Reuse the same built web artifact across its instances.
3. Validate Bicep and review an automated what-if report. Reuse existing infrastructure for app-only changes; infrastructure changes use the authorized infrastructure release path.
4. For later releases, enable the operational admission/claim drain, allow active tenant builds and provisioning to finish, and keep their manifest/source routes serving. If draining exceeds the release deadline, abort the release rather than forcibly restarting active work. First launch has no work to drain.
5. Stop API instances for standalone maintenance; back up/record restore point, run migrations in one job, and start the new API with startup migrations disabled. Existing workers are not restart-resumable: pending items survive, while interrupted claimed items follow existing stale-failure rules.
6. Deploy compatible web/gateway revisions, wait for readiness, verify production-cookie login and server actions, then lift drain and complete the release. Start with a brief controlled maintenance window for API upgrades; do not promise zero downtime.
7. Record image digests, revision names, migration version, configuration version, and smoke results. Roll back application images to the prior compatible release on failure. Do not automatically reverse SQL migrations; old images must remain schema-compatible or require a database recovery procedure.

Leave the tenant YAML pipeline independent. Its existing source authorization and commit-SHA tagging remain intact. Do not replace it with GitHub Actions as part of platform hosting.

## Verification and release acceptance

- Fresh environment can be provisioned with the bootstrap command without creating Azure resources by hand; rerunning converges without duplicating identities, pipeline definitions, plans, or role assignments.
- Both Linux images start using only packaged dependencies; frontend assets load and no private hostname appears in a browser redirect/link.
- Public HTTPS login round-trip produces the Secure, HttpOnly, Path=/ session cookie. Dashboard server rendering receives the session; logout and expiry behave correctly. Verify through the production gateway, not only an in-memory development session test.
- Unauthenticated build-source requests reach Nest and return the expected 401, rather than a gateway 404/login page. Authorized assigned builds can download and stream source through the public `/api` path.
- Runtime identity can load App Configuration/references, sign the GitHub JWT, query SQL, reach the session store/Redis, query Stripe, queue/read DevOps runs, inspect private ACR, and perform permitted ARM operations. Separate checks identify failures without printing credentials.
- Bootstrap admin is assigned explicitly. Test user gets the developer role, app installation on a personal repository, a mapped plan with intended quotas, and an active Stripe test subscription. Super alone does not bypass ownership or subscription checks.
- Complete one end-to-end request: HTTP 202 -> SQL PENDING -> PROVISIONING -> tenant RG/environment ready -> authorized GitHub source build -> private tenant ACR image -> running ACA app/FQDN. Confirm all tenant resources are outside the platform RG and the app cannot access the pull identity's tokens.
- Failed pipeline never creates the tenant app. A pending request survives a controlled restart. Verify controlled drain/rollout and known stale-work failure behavior with an active build; do not claim durable resumption.
- Check metrics, start/stop, quota rejection, authenticated cache behavior, and additional internal ports. External additional TCP ports remain unsupported for newly created user environments because current provisioning does not create their VNets.
- SQL backups and a restore procedure are exercised in a non-production environment. Alert on API readiness failure, queue age/stale failures, dependency failures, SQL/Redis pressure, registry growth, and budget thresholds. Budget alerts do not cap Azure spend.

Hosting does not complete usage metering/overage billing or the unexposed rename/delete cloud workflows noted in the architecture review. Keep initial billing verification in Stripe test mode until live pricing and operating behavior are confirmed.

## Execution order and remaining choices

Implement in this order: runtime packaging and browser auth routing -> infrastructure modules -> external/SQL bootstrap -> first manual CLI-driven release -> automated releases with drain/rollback -> optional domain and stronger isolation.

Inputs needed when implementing, not blockers to drafting: target tenant/subscription, permitted platform region/SKUs, GitHub repository/release branch, existing GitHub App and DevOps organization, known admin GitHub ID, Stripe test credentials/product configuration, and whether to retain Mongo sessions or adopt Redis sessions. Reuse existing resources only after validating their identity, ownership, and compatibility.

Suggested future operator interface, **not executable in the current repository**:

```powershell
az login
gh auth login
pwsh ./scripts/azure/bootstrap.ps1 -Environment production -ParametersFile ./infra/azure/environments/production.bicepparam
```

The script should securely prompt for missing external secrets or read them from an existing secret source. Subsequent platform releases should require only a normal Git push; rollback should be one documented CLI command selecting a recorded compatible release.
