# API configuration

The API reads configuration through NestJS `ConfigService`. `NODE_ENV` and `CONFIG_SOURCE` are independent:

| Setting | Values | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | `production` | Selects the runtime environment and the Azure label override. Set it in the process environment or repository-root `.env`; the process value wins. |
| `CONFIG_SOURCE` | `local`, `azure` | `azure` | Selects where application configuration is loaded from. Set it in the process environment or repository-root `.env`; the process value wins. |

Any combination is supported. For example, `NODE_ENV=development` with `CONFIG_SOURCE=azure` runs development behavior using Azure settings, while `NODE_ENV=production` with `CONFIG_SOURCE=local` uses `.env`. The repository-root `.env` is ignored by Git.

## Local source

Set `CONFIG_SOURCE=local` to load application values from the repository-root `.env`.

## Azure source

Set `CONFIG_SOURCE=azure` and `AZURE_APPCONFIG_ENDPOINT` to the App Configuration store endpoint, such as `https://<store>.azconfig.io`. The endpoint can be set in the process environment or `.env`. When the source is Azure, only `NODE_ENV`, the source switch, and the endpoint are read from `.env` for bootstrap; application values come from Azure. The API authenticates with `DefaultAzureCredential`, which can use a managed identity on Azure or a local Azure CLI sign-in.

To diagnose local Azure access without starting the database, run `npm run check:azure-config` after `az login`. This command uses the Azure CLI identity directly, checks the App Configuration data endpoint, then tries the same full configuration load and Key Vault reference resolution as the API. It reports status without printing configuration values. For an HTTP `403`, it also reports the token's tenant and principal IDs and any error category returned by the store, so they can be compared with the store's IAM and network settings.

API startup emits `Azure configuration diagnostic:` records before the configuration provider replaces failures with its generic fallback message. Records identify App Configuration, Key Vault, or Azure Identity, with HTTP status, recognized transport/authentication error category, and request ID when available. Once a credential acquires a token, only its GUID principal and tenant metadata are reported, when available; compare the principal ID with the Container App system identity Object (principal) ID. This metadata is diagnostic only, not token verification or authorization. Tokens, headers, configuration keys/values, secret names/values, request URLs, response bodies, and raw exception messages are never logged by these diagnostics. App Configuration 403 responses can additionally identify `ip-address-rejected` or `nsp-rejected`; other 403 responses still require checking identity, RBAC propagation, and network policy. No extra environment setting is required.

The API loads all unlabeled App Configuration keys, then applies keys labeled for the current `NODE_ENV` as overrides. Put non-sensitive values in App Configuration. For each secret, create an App Configuration **Key Vault reference** under the configuration key the API should use. The referenced secret remains in Key Vault; the App Configuration provider resolves it at startup using its configured credential. No separate Key Vault URL or secrets client is configured by this application. A secret stored only in Key Vault, without an App Configuration reference, is not loaded.

Give the API identity the **App Configuration Data Reader** role on the store and permission to read the referenced Key Vault secrets (for Azure RBAC, **Key Vault Secrets User**). The API fails startup when the endpoint is missing or the provider cannot load required settings or references.

Use the same key names in `.env` and App Configuration where possible, so `ConfigService.get("KEY")` works in every environment. Dot-separated App Configuration keys become nested configuration paths, such as `database.host`.

## Database settings

The database module requires `DATABASE_URL`, `DATABASE_PORT`, and `DATABASE_NAME` from the selected configuration source. `DATABASE_URL` currently means the SQL Server hostname, such as `<server>.database.windows.net`, rather than a full connection URL. `DATABASE_PORT` must be an integer (typically `1433`). The SQL connection uses Microsoft Entra passwordless authentication through the Azure Identity credential chain; it does not read a SQL username or password. In Azure mode, add these exact keys to App Configuration with no label or with a label matching `NODE_ENV`. Values placed only in `.env` are not loaded in Azure mode.

The Azure SQL logical server must have a Microsoft Entra administrator, and the connecting identity must have a user in the target database. For local development, this is the identity selected by the Azure Identity credential chain; `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` can be used to select the account from `az login`. In Azure Container Apps, create a database user for the app's managed identity. Grant only the database roles the app needs. The database module runs migrations at startup in every environment, so its identity needs the schema modification permissions required by those migrations. TypeORM schema synchronization is disabled.

## GitHub login

Set `GITHUB_OAUTH2_CLIENT_ID`, `GITHUB_OAUTH2_SECRET`, and `GITHUB_OAUTH2_REDIRECT_URL` in the selected configuration source. For the Next.js frontend, the redirect URL must use its `/api/auth/callback` proxy, which forwards to the API's `GET /auth/callback` route. `GET /auth/login` starts the GitHub authorization flow; the callback establishes a Passport session in MongoDB, sets the `connect.sid` cookie, and redirects to `FRONTEND_URL`.

### HTTPS ingress and session cookies

Production session cookies use `Secure`, `HttpOnly`, and `SameSite=Lax`. When Azure Container Apps ingress terminates HTTPS and forwards HTTP to Node, set `TRUST_PROXY_HOPS=1` in the API's selected configuration source and restart/redeploy the API. Express then recognizes the trusted ingress's `X-Forwarded-Proto: https` header and permits the secure session cookie. Without proxy trust, OAuth can finish and redirect successfully while the callback sends no session cookie.

`TRUST_PROXY_HOPS` defaults to `0` (no proxy trust) and accepts a nonnegative safe integer. Set it to the actual trusted proxy hop count for your topology. The immediate trusted ingress must overwrite client-supplied forwarding headers, and callers must not be able to bypass it to reach Node directly. Multiple paths of different lengths need a separate proxy trust design rather than an arbitrarily large hop count. Keep secure cookies enabled in production.

To verify, preserve the browser Network log through login and inspect the API callback's 302 response for `Set-Cookie: connect.sid=...; ...; Secure; HttpOnly; SameSite=Lax`. Inspect browser cookie storage on the callback hostname; HttpOnly cookies are absent from `document.cookie`. Cookies are host-only: separate API and frontend hostnames do not share this cookie. The current frontend forwards its incoming cookie for server-side API requests, so production must also provide a common browser origin (for example, path-based API routing) or a separately designed session-sharing arrangement. Proxy trust alone does not solve hostname separation. If the callback still sends no cookie, inspect API session-store errors and MongoDB connectivity.

Application settings are loaded at startup; changes in Azure require an API restart to take effect. Feature flags are loaded at startup by a separate module and polled from Azure App Configuration every 12 hours. Consumers of the `FEATURE_FLAGS` provider read its current `feature_flags` property to get the latest snapshot. If a poll fails, the last known flags remain available until a later poll succeeds. With `CONFIG_SOURCE=local`, the provider supplies an empty flag list and does not poll.

### Frontend authentication proxy

Next.js exposes GET `/api/auth/login`, `/api/auth/callback`, and `/api/auth/github/install`. It forwards only these paths to the backend selected by runtime `API_URL`, preserving query strings and incoming cookies. It returns upstream redirects without following them and forwards each Set-Cookie header separately. Responses are uncached; unavailable upstream requests return a sanitized 502. Other auth paths return 404, and mutation methods are not exposed by this proxy. Existing frontend server actions continue calling the backend directly with the incoming cookie.

The frontend `/auth/login` route redirects to `/api/auth/login`, and GitHub installation links use `/api/auth/github/install`. The full browser flow is frontend login → proxied backend redirect → GitHub → frontend callback proxy → backend session creation → frontend redirect. Because the browser receives the callback response on the frontend hostname, the host-only cookie belongs to the frontend. Leave the backend cookie Domain unset; no shared parent-domain cookie is needed.

For the current production hosts, set these backend settings in the selected configuration source (Azure App Configuration when `CONFIG_SOURCE=azure`):

```dotenv
GITHUB_OAUTH2_REDIRECT_URL=https://kumo.justapie.dev/api/auth/callback
FRONTEND_URL=https://kumo.justapie.dev
TRUST_PROXY_HOPS=1
```

Set the GitHub application's OAuth callback URL to `https://kumo.justapie.dev/api/auth/callback` as well. The frontend container keeps runtime `API_URL=https://kumo-api.justapie.dev`; it must point directly to the backend, not back to the frontend proxy. Keep HTTPS on that backend connection so ACA's trusted ingress reports HTTPS. Rebuild/redeploy the frontend and restart/redeploy the backend after updating its configuration. Clear old connect.sid cookies on both hostnames and sign in through the frontend. Inspect the frontend callback's 302 Set-Cookie header and confirm the next frontend request carries connect.sid and the dashboard recognizes the session. OAuth and live MongoDB/Azure behavior still require verification in the deployed environment.

For local development, use the frontend's actual origin for `FRONTEND_URL` and `<frontend-origin>/api/auth/callback` for both callback settings. Keep `API_URL` pointing to the local backend and `NODE_ENV=development` on the API for HTTP cookies.

## GitHub webhooks

Set `GITHUB_WEBHOOK_SECRET` to the same secret configured on the GitHub App webhook. Use `POST /github/webhook` as the webhook URL with JSON content. Missing or blank configuration disables receipt with HTTP 503; incorrect signatures return 401. See [GitHub webhook setup and verification](github-webhooks.md).

## GitHub installation tokens

### GitHub App installation redirect

Signed-in users can list their own personally owned repositories granted to the app through `GET /auth/github/repositories`. This endpoint uses the existing app credentials and no additional configuration. See [installed GitHub repositories](github-repositories.md) for ownership restrictions, pagination, and response fields.

No additional app-name configuration is required. The backend calls GitHub's authenticated `GET /app` endpoint using a JWT signed with the existing app client ID and Key Vault signing key, then constructs the installation URL from the returned app slug.

Navigate the browser to `GET /auth/github/install` with the existing Kumo session cookie. An authenticated, active, unsuspended user receives HTTP 302 to `https://github.com/apps/<resolved-app-slug>/installations/new`, where GitHub handles account and repository selection. Existing installations can be configured through GitHub's installation flow to grant access to additional repositories. No deployment permission or subscription is required. Responses use `private, no-store`; ineligible sessions return 403 and failed app discovery or an invalid GitHub response returns 503. The endpoint accepts no client-controlled redirect destination and does not create an installation or grant repository access itself.

This endpoint does not process installation callbacks or change the login callback. Configure the GitHub App's Setup URL separately if a return page after installation is desired. GitHub remains responsible for installation permissions and organization approval. See [GitHub's installation-link documentation](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app).

Import `GitHubModule` from `@kumo/infrastructure` in a consuming NestJS module and inject `GitHubProvider`. Call `getRepositoryAccessToken(owner, repo)` with the GitHub account or organization name and repository name after authorizing the user's access to the repository. The provider looks up the repository's app installation and returns a fresh token limited to that repository with `contents: read`; it does not store or log the token.

| Setting | Purpose |
| --- | --- |
| `GITHUB_APP_CLIENT_ID` | Optional explicit GitHub App client ID; falls back to `GITHUB_OAUTH2_CLIENT_ID`. The configured app must correspond to the key used for signing. |
| `GITHUB_APP_PRIVATE_KEY_NAME` | Name of the RSA key under Key Vault **Keys**, corresponding to the GitHub App's registered public key. |
| `AZURE_VAULT_NAME` | Key Vault name or full vault URL, such as `https://example.vault.azure.net`. |

The provider manually constructs the app JWT and uses `KmsProvider` to sign it with RS256 in Key Vault. The private key is never downloaded. The Azure identity needs permission to retrieve key metadata and sign with the selected key. The GitHub App must be installed on the selected repositories and have Contents read permission. The token expires according to GitHub's response (normally one hour); request another token when needed. This flow uses Key Vault's key API separately from App Configuration's secret references.

## Image build processing

The temporary HTTP build trigger has been removed. The internal build use case and database-backed API worker remain available, but there is currently no public route for submitting new builds. The worker checks access, resolves the commit, and starts an Azure Pipeline. The requesting user must be a collaborator (including the repository owner) on the repository, and the GitHub App must be installed on it with Contents read permission. Preparation failures appear in the polled build's `error` field. The pipeline requests its source later from Kumo.

The internal build input accepts a Dockerfile path relative to the repository root, defaulting to `Dockerfile`. The repository root remains the Docker build context even when the Dockerfile is in a subdirectory. An optional Git reference overrides a repository URL's `#ref` fragment, otherwise the default branch is used. The provider resolves the reference to a commit SHA. Image names use lowercase letters, digits, and separators (`.`, `_`, `-`). Deployment input does not accept `tag`; the worker uses the resolved full lowercase Git commit SHA as the image tag. The optional `image_name` defaults to the app name. The pipeline uses its configured agent pool.

| Setting | Purpose |
| --- | --- |
| `AZURE_DEVOPS_ORGANIZATION` | Azure DevOps organization name, without a URL scheme. |
| `AZURE_DEVOPS_PROJECT` | Project name or ID containing the platform build pipeline. |
| `AZURE_DEVOPS_PIPELINE_ID` | Numeric pipeline ID. |
| `AZURE_DEVOPS_PAT` | Optional secret for local testing, with Build Read & execute access. When absent, DefaultAzureCredential acquires a Microsoft Entra token for Azure DevOps. |
| `AZURE_CONTAINER_REGISTRY_SERVER` | Registry login hostname, such as `kumoregistry.azurecr.io`, without `https://`. |

The API identity needs permission to read and sign the GitHub App key (for example Key Vault Crypto User). Add the backend's Azure identity to the Azure DevOps organization and grant it permission to queue and view this pipeline. The pipeline uses a separate Azure service connection to authenticate image pushes to ACR. ACR Tasks permissions are not needed for the active build path. See [Azure Pipelines setup](azure-pipelines.md) for the pipeline variables, service connection, public API URL, and agent requirements.

The internal build use case persists a pending build with its repository, Dockerfile path, image address, and a hash of a random build-source credential. The worker resolves the authorized commit and records the pipeline run. Only the build ID is passed as a pipeline parameter; the credential is passed as a secret pipeline variable. It expires after 24 hours and is rejected for terminal builds. Authorization headers and cookies are redacted from request logs.

`GET /builds/:id/manifest` and `GET /builds/:id/source` authenticate with the credential assigned to that build. The manifest exposes build ID, image, Dockerfile path, and commit SHA. The pipeline verifies that the manifest build ID matches its assigned build and that the image tag matches the manifest commit SHA. The source endpoint rechecks GitHub access, downloads the saved commit, removes GitHub's wrapper directory, verifies the Dockerfile exists, and serves a gzip archive. GitHub tokens remain in Kumo's backend. Temporary local files are removed after source preparation. Compressed GitHub source is limited to 100 MiB and extracted source to 256 MiB. Archive downloads do not fetch Git history or recursively clone submodules.

New internal builds have status `PENDING`; `run_id`, `run_url`, `commit_sha`, and `error` are initially null. Before source resolution the image contains only `<registry>/<imageName>`; the worker then persists `<registry>/<imageName>:<commitSha>` with the full resolved commit SHA, without a user namespace. Build tracking IDs remain unique UUIDs. Rebuilding an image name at the same commit SHA pushes to the same registry reference; image names and commit tags share the registry namespace across users. The pipeline builds and pushes the image to ACR. `GET /deployment/build/:id` is restricted to the build's owner and reports preparation progress or failure, then refreshes scheduled run status from Azure DevOps. Poll every few seconds until `SUCCEEDED`, `FAILED`, or `CANCELED`. The worker starts with the API, claims pending builds once, and marks interrupted preparation failed after ten minutes. Pending work resumes after a restart. Status updates are polled on demand; there is no completion webhook or automatic ACA deployment. The builds and asynchronous queue SQL migrations run through the API's existing migration mechanism on startup. See [Azure Pipelines setup](azure-pipelines.md) for worker and recovery details.

## Deployment & Azure Container Apps

`AzureProvider.createDeployment()` ensures `user-rg-<userId>` exists, then ensures `user-aca-env-<userId>` is ready. All of a user's apps share that environment. Existing apps are returned without rebuilding. For a new app, the provider checks the private registry, submits a build through the existing internal build use case, and waits for success before creating the app. Build failure, cancellation, or timeout prevents app creation. The deployment HTTP entry point is not connected to this operation yet.

| Setting | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AZURE_SUBSCRIPTION_ID` | Yes | None | Subscription used by the ARM and Container Apps clients. |
| `AZURE_PLATFORM_RESOURCE_GROUP` | Yes, or supply `AZURE_RG_NAME` | Falls back to `AZURE_RG_NAME` | Platform resource group that user workload operations must never target. |
| `AZURE_CONTAINER_REGISTRY_SERVER` | For app creation | None | Private ACR login hostname; must match the registry resource and built image. |
| `AZURE_CONTAINER_REGISTRY_RESOURCE_ID` | For app creation, or supply the fallback settings | Derived from subscription ID, `AZURE_RG_NAME`, and `AZURE_CONTAINER_REGISTRY_NAME` | ACR resource ID used to verify that anonymous pull is disabled. |
| `AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME` | For app creation | None | Name of an existing user-assigned managed identity with ACR pull access, for example `azure-managed-id`. Its resource ID is constructed using `AZURE_SUBSCRIPTION_ID` and the platform resource group (`AZURE_PLATFORM_RESOURCE_GROUP`, falling back to `AZURE_RG_NAME`). |
| `AZURE_DEPLOYMENT_TIMEOUT_MS` | No | `3600000` | Maximum time for one deployment operation, including provisioning and waiting for its build. |
| `AZURE_DEPLOYMENT_POLL_INTERVAL_MS` | No | `5000` | Interval for checking in-progress environments and builds. Must be positive and no greater than the timeout. |

These settings can be configured via `.env` for local execution or Azure App Configuration. The API uses `DefaultAzureCredential` to authenticate ARM operations. Before creating a missing managed environment, it creates/reuses `user-vnet-<userId>` and its delegated infrastructure subnet in the same user resource group and region, and waits for network readiness. The API identity also needs virtual-network/subnet read/write and subnet join permissions in user resource groups. Its identity needs permission to create resources in the user groups, read the ACR resource, and assign the configured user-assigned identity to Container Apps. The pull identity needs `AcrPull` for an RBAC registry or the appropriate repository reader role for an ABAC registry. Keep ACR anonymous pulls disabled; the provider rejects registries where the flag is enabled or cannot be confirmed as disabled. See [ACR anonymous pull access](https://learn.microsoft.com/en-us/azure/container-registry/anonymous-pull-access).

Set `AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME=azure-managed-id` for an identity named `azure-managed-id` in the configured subscription and platform resource group. The provider constructs the full resource ID required by Azure internally. Container Apps authenticates image pulls with that managed identity, rather than a registry password or a temporary backend token. The identity is configured with lifecycle `None` so code inside user containers cannot obtain its tokens. See [managed identity availability](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity#control-managed-identity-availability).

Users select their region through the optional `region` field in a deployment creation request. The selected region applies to new groups and environments, including new environments in an existing group. When omitted, a new group defaults to `southeastasia` and a new environment uses its group's location. An existing shared environment must match any explicitly selected region; a mismatch fails before building. Selection does not move or recreate an existing environment. The app uses its environment's region. Deployment creation requires a target port and explicit CPU, memory, and scaling choices. The app defaults to external HTTPS ingress; top-level `external: false` restricts ingress to apps within the same environment. Resources created before a failed build are retained for later deployments.

New environments explicitly use `environmentMode: WorkloadProfiles` with a `Consumption` profile, and apps select that profile. Existing Express environments are rejected before starting a build. An `ExpressEnvironmentFeatureNotSupported` error indicates the environment does not support part of the requested app configuration. Restarting the API or changing the app name does not replace the shared user environment: it must be separately migrated or replaced with a standard environment. Kumo does not automatically delete environments or their workloads. See [Express capabilities](https://learn.microsoft.com/azure/container-apps/express-overview).

## Deployment creation

Signed-in users can discover candidate deployment regions through `GET /regions`, using the existing `AZURE_SUBSCRIPTION_ID` and backend Azure credential. See [region discovery](regions.md) for resource-support filtering, required read permissions, and limits. The endpoint does not accept a client-supplied subscription.

### API response caching

The API uses the existing Redis cache configured by `REDIS_CONNECTION_URL` for explicitly selected reads:

| Route | Server cache policy |
| --- | --- |
| `GET /deployments` | 2 seconds, scoped by authenticated user and complete filter query. |
| `GET /deployments/:id` | 2 seconds, scoped by authenticated user and deployment ID. |
| `GET /deployment/build/:id` | 2 seconds, scoped by authenticated user and build ID. Internal worker calls to the build use case are unaffected. |
| `GET /user/me` | Uncached; uses the current authenticated user. |
| Auth login/callback/logout | Uncached. |
| Build manifest/source downloads | Uncached; authorization and expiry are checked on every request. |
| Deployment creation | Uncached; successful creation invalidates that user's deployment list/detail cache generations. |

Authentication still runs on cache hits, suspended users cannot use cached responses, and errors are not cached. Cache entries contain only exposed response fields, not domain objects, build-source tokens, or request cookies. Keys separate users, include the route/query, and sort query parameter names. Redis failures fall back to normal request processing. `X-Cache` reports `HIT`, `MISS`, or `BYPASS` for eligible reads. Clients can bypass the server cache with request `Cache-Control: no-cache` or `no-store` (or `Pragma: no-cache`).

These authenticated responses retain `Cache-Control: private, no-store` so browsers and shared proxies do not retain them; the short-lived Redis cache is separate. Background worker updates can appear up to two seconds later on cached reads. Future deployment mutations must invalidate the user's deployment cache as creation does. Frontend requests that explicitly send cache-bypass directives remain fresh.

### Listing and filtering deployments

`GET /deployments` returns the authenticated user's deployments, newest first. Optional query filters can be combined with AND:

| Query parameter | Match |
| --- | --- |
| `status` | One of `PENDING`, `PROVISIONING`, `RUNNING`, `FAILED`, or `DELETED`. |
| `name` | Case-insensitive literal substring, 1–32 characters after trimming. |
| `region` | Exact requested region saved with the deployment, such as `japaneast`. Deployments created without an explicit region do not match this filter. |

Example: `GET /deployments?status=RUNNING&name=api&region=japaneast`. Filters run in the database and cannot change the authenticated user scope. Omitting all filters returns the full owned list. Invalid, empty, repeated, or unknown parameters return HTTP 400; no matches returns an empty array.

The web dashboard loads this endpoint on the server through the generated REST client, forwarding the incoming session cookie with caching disabled. Its name, status, and region controls update `/dashboard` query parameters when Apply filters is selected; Reset removes the filters, and Refresh fetches the current list again. No periodic polling is enabled. The page displays sign-in, request failure, loading, and empty-result states separately. Deployment rows keep image references compact and let users expand error details. The web server uses its configured `API_URL` (falling back to `NEXT_PUBLIC_API_URL`, then `http://localhost:3000`) to reach the API.

### Creating a deployment

Submit an authenticated `POST /deployments` request:

```json
{
  "name": "my-app",
  "region": "japaneast",
  "repo": "https://github.com/example/my-app",
  "target_port": 3000,
  "max_vcpu": 0.5,
  "max_memory": 1,
  "min_scaling": 0,
  "max_scaling": 2
}
```

Memory is in GiB and must be exactly twice vCPU. Both settings apply per replica; vCPU must be a positive multiple of 0.25. Scaling values are integer replica counts with `0 <= min_scaling <= max_scaling` and `max_scaling >= 1`. Invalid choices return HTTP 400. Optional fields are `image_name` (defaults to the app name), `dockerfile_path` (defaults to `Dockerfile`), `ref`, and `env_vars` (string values). Names must be unique per user; duplicates return HTTP 409.

`region` is also optional and must be a lowercase Azure location name, such as `japaneast`, without spaces. Azure validates service availability and subscription restrictions. Responses echo the requested region, or `null` when none was supplied. Region is persisted in the existing creation JSON; no database migration is needed.

The API returns HTTP 202 with the deployment ID and `PENDING` status. Poll `GET /deployments/:id` for progress, or list owned deployments with `GET /deployments`. The worker marks the request `PROVISIONING`, ensures the resource group and shared user environment are ready, starts a build, and waits for success before creating the Container App. It deploys that build's image and applies the chosen resources and replica counts. Build failure or cancellation prevents app creation. The existing owner-scoped `GET /deployment/build/:id` provides build details once `build_id` is available.

Successful provisioning records `RUNNING`, the image, Azure resource ID, and FQDN. `RUNNING` means Azure provisioning succeeded; application health is not independently checked. Failures record `FAILED` and an error. Pending requests survive API restarts. Provisioning interrupted beyond `AZURE_DEPLOYMENT_TIMEOUT_MS` plus one minute is marked failed without automatic resubmission. The worker processes one deployment at a time per API instance; claims are conditional database updates so instances do not process the same pending request.

Provisioning errors identify the failed step (resource group, virtual network, managed environment, Container App lookup, private registry lookup, build submission/completion, or app creation). Azure failures expose sanitized error names/codes and HTTP status rather than response bodies or credentials. Missing deployment configuration identifies the required key without exposing its value. A failure with no `build_id` means no build reference was recorded; inspect the stage before checking Azure Pipelines. Resource-group and managed-environment readiness precede build submission.

The appended deployment workflow migration runs at API startup and adds persisted creation requests, build/image/resource references, a queue index, and a unique user/name index. Existing duplicate user/name rows must be resolved before that index can be created. No new pipeline parameters are needed for CPU, memory, or scaling; these are applied by the Azure provider after the build.

The subsequent `RemoveUnusedDeploymentSpecs1792108800001` migration drops the obsolete `deployment_specs` table and its legacy rows. Current deployment settings remain in `deployments.creation_request`. Rolling back recreates the legacy table, indexes, and foreign key, but does not recover dropped rows. Historical migrations remain registered for existing databases and fresh installations.

The `Plans1792108800002` migration creates `plans` from the domain plan fields: `id` and `name` (`nvarchar(255)`), `price` (`decimal(19,4)`), `vcpu` and `memory` (`float`), and `deployments` and `disk` (`int`). All fields are required; `id` is the primary key. Database checks require nonnegative price, positive vCPU, memory equal to twice vCPU, and positive deployment/disk counts. No plans are seeded. The `InfraPlan` entity is registered with TypeORM. Currency, billing period, and disk units are not defined by this schema.

`PlanActive1792108800003` adds the non-null `active` bit column, defaulting to `true` for existing and new rows. The domain model also defaults omitted `active` values to `true` and accepts explicit `false`.

### Container visibility

Deployment creation accepts optional top-level `external`: true (the default) enables ingress outside the environment, while false restricts it to other Container Apps in the same environment. This controls the application ingress, separately from each additional port's `external` flag. Internal applications cannot have external additional TCP ports; incompatible requests return HTTP 400 before persistence. Saved legacy inputs without this field retain external ingress. New responses include `external`; provisioned GETs read the applied value from Azure and return null if it is absent. The existing creation-request JSON stores visibility without a database migration.

### Additional ports

Keep `target_port` for the main application ingress. Add up to five extra TCP mappings using `additional_ports`, for example:

```json
{
  "target_port": 3000,
  "additional_ports": [
    { "target_port": 8080 },
    { "target_port": 9090, "exposed_port": 9091, "external": false }
  ]
}
```

This is a fragment of the creation request; the other required fields still apply. Each mapping forwards its exposed TCP port to the target port inside the container. The exposed port defaults to the target port, and `external` defaults to `false`, allowing access within the shared user environment. The application must listen on every configured target port. Deployment responses include the main target and normalized additional mappings; older requests without additional mappings return an empty list. Mappings are stored in the existing creation JSON, requiring no additional database migration or pipeline change.

Additional target ports must be distinct from each other and from the primary target. Additional exposed ports must be distinct within the app. Port numbers must be integers from 1 to 65535; Azure reserves 36985. External mappings also cannot expose 80 or 443 and require top-level `external` to be true or omitted. Azure requires external exposed ports to be unique across the environment and requires VNet integration for external additional ports. Kumo rejects external mappings before building when the environment lacks an infrastructure subnet. New environments automatically attach to a delegated subnet in `user-vnet-<userId>` in the same user resource group. Existing environments without VNet integration require separate migration. See [user networking](user-networking.md). Additional ports use TCP; built-in HTTP ingress features apply to the primary ingress. See [Azure additional TCP port requirements](https://learn.microsoft.com/en-us/azure/container-apps/ingress?tabs=bash#additional-tcp-ports).

## Stripe settings

`STRIPE_SECRET_KEY` is required by `StripeModule` when the API starts. Set it in the selected configuration source: the repository-root `.env` for local configuration, or an App Configuration Key Vault reference for Azure configuration. Keep the secret on the server.

The plan subscription Checkout endpoint also requires `FRONTEND_URL`. Configure the frontend's HTTP(S) base URL without embedded credentials. Stripe Checkout success and cancellation both return to its `/dashboard` path; browser requests cannot override these destinations. See [plan subscriptions](plan-subscriptions.md).

For each active local plan, configure all billable components as active prices on its linked Stripe product. Checkout paginates and includes every active price, including metered recurring prices and one-time initial charges. Clients cannot select individual Price IDs. At least one recurring price is required; Stripe Checkout limits and price compatibility must be respected. Archive unused/alternative prices to keep them out of the combined purchase; the default price does not limit selection.

The presentation module constructs the Stripe SDK client and injects it into the infrastructure `StripeProvider`, which is exported by the module.

The provider supports customer creation linked through `metadata.kumoId` without an email, active product queries, recurring price queries for a product, customer subscription queries (all statuses by default), and direct subscription creation. List methods return a Stripe page with `has_more` and accept pagination parameters such as `starting_after`.

`createCustomer(userId, idempotencyKey)` and `subscribeTo(customerId, priceId, idempotencyKey)` require a caller-persisted Stripe idempotency key. Reuse that key with identical parameters when retrying the same operation; use a new key for a new operation. Subscription creation requires a recurring Price ID (`price_...`), not a Product ID (`prod_...`). It uses `default_incomplete`, saves the successful payment method on the subscription, and expands `latest_invoice.confirmation_secret` for initial payment confirmation. Creating the subscription does not establish that payment succeeded.

Application use cases must resolve customer ownership, reserve one subscription slot per user through the UoW, and synchronize billing through verified webhooks. The provider performs Stripe operations and does not enforce that application-level invariant or grant deployment entitlements.

### Stripe customer linking on login

New users and existing users without a Stripe Customer ID are linked by `CreateUserCase` before the GitHub login callback establishes its session. Suspended users and users already linked do not create Customers. Stripe receives only `metadata.kumoId`, with no user email. `users.stripe_customer_id` persists the association; a filtered unique index prevents assigning one Customer to two users. Ordinary user saves preserve this column.

The appended `UserStripeCustomer1792368000000` migration adds that nullable user column and the `stripe_customer_links` operation table. Existing users are linked on their next successful OAuth login; session deserialization does not make billing calls. The migration is registered for the existing startup migration mechanism; compilation does not apply it.

Local user creation is serialized inside the UoW. Linking claims a durable per-user operation in a short SQL transaction with a two-minute lease, calls Stripe outside the transaction, and conditionally saves the returned Customer ID in another transaction. Concurrent logins wait up to 30 seconds for the same link. Failed calls and failed completion writes keep the original operation and Stripe idempotency key. Process interruption permits another replica to reclaim the expired lease, reusing the same key. A stale lease owner cannot overwrite another operation's result.

After 23 hours, an unresolved creation operation refuses automatic customer creation and requires reconciliation, because Stripe may discard idempotency results after 24 hours. No new key is generated for an uncertain result. Stripe or persistence failures prevent that login from completing, while preserving the local user for a later retry. Rolling back the migration removes customer associations and retry records, so reconcile existing Stripe Customers before enabling linking again after such a rollback.


## Rebuilding existing deployments

Use `POST /deployments/:id/redeploy` with the current session and an `Idempotency-Key`, without a body. The existing worker rebuilds the saved Git reference and updates only that user's existing app after the Azure Pipeline succeeds. No new configuration keys or fixed pipeline deployment targets are needed. See [redeployment](redeployment.md) for permissions, billing checks, status, and recovery limits.
