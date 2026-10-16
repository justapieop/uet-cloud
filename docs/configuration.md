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

The API loads all unlabeled App Configuration keys, then applies keys labeled for the current `NODE_ENV` as overrides. Put non-sensitive values in App Configuration. For each secret, create an App Configuration **Key Vault reference** under the configuration key the API should use. The referenced secret remains in Key Vault; the App Configuration provider resolves it at startup using its configured credential. No separate Key Vault URL or secrets client is configured by this application. A secret stored only in Key Vault, without an App Configuration reference, is not loaded.

Give the API identity the **App Configuration Data Reader** role on the store and permission to read the referenced Key Vault secrets (for Azure RBAC, **Key Vault Secrets User**). The API fails startup when the endpoint is missing or the provider cannot load required settings or references.

Use the same key names in `.env` and App Configuration where possible, so `ConfigService.get("KEY")` works in every environment. Dot-separated App Configuration keys become nested configuration paths, such as `database.host`.

## Database settings

The database module requires `DATABASE_URL`, `DATABASE_PORT`, and `DATABASE_NAME` from the selected configuration source. `DATABASE_URL` currently means the SQL Server hostname, such as `<server>.database.windows.net`, rather than a full connection URL. `DATABASE_PORT` must be an integer (typically `1433`). The SQL connection uses Microsoft Entra passwordless authentication through the Azure Identity credential chain; it does not read a SQL username or password. In Azure mode, add these exact keys to App Configuration with no label or with a label matching `NODE_ENV`. Values placed only in `.env` are not loaded in Azure mode.

The Azure SQL logical server must have a Microsoft Entra administrator, and the connecting identity must have a user in the target database. For local development, this is the identity selected by the Azure Identity credential chain; `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` can be used to select the account from `az login`. In Azure Container Apps, create a database user for the app's managed identity. Grant only the database roles the app needs. The database module runs migrations at startup in every environment, so its identity needs the schema modification permissions required by those migrations. TypeORM schema synchronization is disabled.

## GitHub login

Set `GITHUB_OAUTH2_CLIENT_ID`, `GITHUB_OAUTH2_SECRET`, and `GITHUB_OAUTH2_REDIRECT_URL` in the selected configuration source. The redirect URL must point to this API's `GET /auth/callback` route. `GET /auth/login` starts the GitHub authorization flow; the callback returns the verified user. The API does not yet issue a session or application token, so this response does not authenticate later requests.

Application settings are loaded at startup; changes in Azure require an API restart to take effect. Feature flags are loaded at startup by a separate module and polled from Azure App Configuration every 12 hours. Consumers of the `FEATURE_FLAGS` provider read its current `feature_flags` property to get the latest snapshot. If a poll fails, the last known flags remain available until a later poll succeeds. With `CONFIG_SOURCE=local`, the provider supplies an empty flag list and does not poll.

## GitHub installation tokens

Import `GitHubModule` from `@kumo/infrastructure` in a consuming NestJS module and inject `GitHubProvider`. Call `getRepositoryAccessToken(owner, repo)` with the GitHub account or organization name and repository name after authorizing the user's access to the repository. The provider looks up the repository's app installation and returns a fresh token limited to that repository with `contents: read`; it does not store or log the token.

| Setting | Purpose |
| --- | --- |
| `GITHUB_APP_CLIENT_ID` | Optional explicit GitHub App client ID; falls back to `GITHUB_OAUTH2_CLIENT_ID`. The configured app must correspond to the key used for signing. |
| `GITHUB_APP_PRIVATE_KEY_NAME` | Name of the RSA key under Key Vault **Keys**, corresponding to the GitHub App's registered public key. |
| `AZURE_VAULT_NAME` | Key Vault name or full vault URL, such as `https://example.vault.azure.net`. |

The provider manually constructs the app JWT and uses `KmsProvider` to sign it with RS256 in Key Vault. The private key is never downloaded. The Azure identity needs permission to retrieve key metadata and sign with the selected key. The GitHub App must be installed on the selected repositories and have Contents read permission. The token expires according to GitHub's response (normally one hour); request another token when needed. This flow uses Key Vault's key API separately from App Configuration's secret references.

## Image build processing

The temporary HTTP build trigger has been removed. The internal build use case and database-backed API worker remain available, but there is currently no public route for submitting new builds. The worker checks access, resolves the commit, and starts an Azure Pipeline. The requesting user must be a collaborator (including the repository owner) on the repository, and the GitHub App must be installed on it with Contents read permission. Preparation failures appear in the polled build's `error` field. The pipeline requests its source later from Kumo.

The internal build input accepts a Dockerfile path relative to the repository root, defaulting to `Dockerfile`. The repository root remains the Docker build context even when the Dockerfile is in a subdirectory. An optional Git reference overrides a repository URL's `#ref` fragment, otherwise the default branch is used. The provider resolves the reference to a commit SHA. Image names use lowercase letters, digits, and separators (`.`, `_`, `-`). The pipeline uses its configured agent pool.

| Setting | Purpose |
| --- | --- |
| `AZURE_DEVOPS_ORGANIZATION` | Azure DevOps organization name, without a URL scheme. |
| `AZURE_DEVOPS_PROJECT` | Project name or ID containing the platform build pipeline. |
| `AZURE_DEVOPS_PIPELINE_ID` | Numeric pipeline ID. |
| `AZURE_DEVOPS_PAT` | Optional secret for local testing, with Build Read & execute access. When absent, DefaultAzureCredential acquires a Microsoft Entra token for Azure DevOps. |
| `AZURE_CONTAINER_REGISTRY_SERVER` | Registry login hostname, such as `kumoregistry.azurecr.io`, without `https://`. |

The API identity needs permission to read and sign the GitHub App key (for example Key Vault Crypto User). Add the backend's Azure identity to the Azure DevOps organization and grant it permission to queue and view this pipeline. The pipeline uses a separate Azure service connection to authenticate image pushes to ACR. ACR Tasks permissions are not needed for the active build path. See [Azure Pipelines setup](azure-pipelines.md) for the pipeline variables, service connection, public API URL, and agent requirements.

The internal build use case persists a pending build with its repository, Dockerfile path, image address, and a hash of a random build-source credential. The worker resolves the authorized commit and records the pipeline run. Only the build ID is passed as a pipeline parameter; the credential is passed as a secret pipeline variable. It expires after 24 hours and is rejected for terminal builds. Authorization headers and cookies are redacted from request logs.

`GET /builds/:id/manifest` and `GET /builds/:id/source` authenticate with the credential assigned to that build. The manifest exposes only image, Dockerfile path, and commit SHA. The source endpoint rechecks GitHub access, downloads the saved commit, removes GitHub's wrapper directory, verifies the Dockerfile exists, and serves a gzip archive. GitHub tokens remain in Kumo's backend. Temporary local files are removed after source preparation. Compressed GitHub source is limited to 100 MiB and extracted source to 256 MiB. Archive downloads do not fetch Git history or recursively clone submodules.

New internal builds have status `PENDING`; `run_id`, `run_url`, `commit_sha`, and `error` are initially null. The image uses a unique tag under `kumo/<GitHub-user-ID>/<image_name>`. The pipeline builds and pushes the image to ACR. `GET /deployment/build/:id` is restricted to the build's owner and reports preparation progress or failure, then refreshes scheduled run status from Azure DevOps. Poll every few seconds until `SUCCEEDED`, `FAILED`, or `CANCELED`. The worker starts with the API, claims pending builds once, and marks interrupted preparation failed after ten minutes. Pending work resumes after a restart. Status updates are polled on demand; there is no completion webhook or automatic ACA deployment. The builds and asynchronous queue SQL migrations run through the API's existing migration mechanism on startup. See [Azure Pipelines setup](azure-pipelines.md) for worker and recovery details.

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

These settings can be configured via `.env` for local execution or Azure App Configuration. The API uses `DefaultAzureCredential` to authenticate ARM operations. Its identity needs permission to create resources in the user groups, read the ACR resource, and assign the configured user-assigned identity to Container Apps. The pull identity needs `AcrPull` for an RBAC registry or the appropriate repository reader role for an ABAC registry. Keep ACR anonymous pulls disabled; the provider rejects registries where the flag is enabled or cannot be confirmed as disabled. See [ACR anonymous pull access](https://learn.microsoft.com/en-us/azure/container-registry/anonymous-pull-access).

Set `AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME=azure-managed-id` for an identity named `azure-managed-id` in the configured subscription and platform resource group. The provider constructs the full resource ID required by Azure internally. Container Apps authenticates image pulls with that managed identity, rather than a registry password or a temporary backend token. The identity is configured with lifecycle `None` so code inside user containers cannot obtain its tokens. See [managed identity availability](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity#control-managed-identity-availability).

The optional deployment input region defaults to `southeastasia` for a new resource group. A new environment uses the requested region or the existing group's location, and the app uses its environment's region. The input requires a target port; the app has external HTTPS ingress, defaults to 0.25 CPU and 0.5 GiB memory, and scales between zero and two replicas unless overridden. Resources created before a failed build are retained for later deployments.
