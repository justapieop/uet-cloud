# New Azure environment

Use `infra/azure/main.bicep` for a **new** Kumo environment. The existing-resource
IAM entry point remains `infra/azure/iam.bicep`; it is not the full infrastructure
template. No new environment has been deployed as part of writing this template.

## Resources

- A new resource group with deterministic environment/subscription-specific names.
- A VNet with separate delegated Container Apps and private-endpoint subnets.
- A standard Workload Profiles Container Apps environment with Consumption and
  a system identity. A Log Analytics workspace is optional and off by default.
- Separate private ABAC registries for platform images and customer-built images.
  Anonymous pull and registry admin credentials are disabled on both.
- Separate runtime, platform image-pull, and customer image-pull identities.
- Azure SQL server/database with Entra-only authentication and its free allowance,
  small non-HA Managed Redis, and DocumentDB/MongoDB Free for `connect-mongo` sessions.
- Public SQL and MongoDB endpoints restricted by firewall rules to Azure-service
  traffic and explicitly supplied administrator IPv4 addresses. The Azure-service
  exception includes other subscriptions; it is not restricted to this environment.
  Database authentication remains required. No Internet-wide allow-all rule is used.
- A private endpoint and DNS zone for Redis, with its public access disabled.
  Managed Redis has no equivalent public-IP allowlist feature. SQL/Mongo private
  endpoints can be enabled with `usePrivateSqlAndMongo=true` instead of their
  public firewall rules. Key Vault and App Configuration use TLS endpoints with RBAC.
- Key Vault, App Configuration, generated SQL/Azure/URL settings, and Key Vault
  references for data connection strings and external credentials.
- Runtime IAM from the shared IAM template, plus scoped operator permissions to
  upload secrets, import the GitHub key, edit settings, and publish platform images.
- Optional API and Next.js Container Apps. Applications are off by default until
  database initialization, secrets, integrations, and actual images are ready.

Names are generated from `environmentName` and a subscription-specific suffix;
no resource IDs, credentials, domains, or images from the existing Kumo deployment
are copied. Different environment names create different stacks. The new IAM role
namespace also avoids editing the current deployment's custom role definitions.
The template targets Azure public cloud and requires the services to be supported
in the chosen region. It does not create a subscription or register external apps.

## Inputs and first deployment

Install Azure CLI with Bicep and Container Apps support. Sign in and select the
intended subscription. The deploying operator needs resource-creation permission
and permission to create custom roles and role assignments at subscription scope.
Required resource providers are Microsoft.Resources, Microsoft.Network,
Microsoft.App, Microsoft.OperationalInsights, Microsoft.ManagedIdentity,
Microsoft.ContainerRegistry, Microsoft.KeyVault, Microsoft.AppConfiguration,
Microsoft.Sql, Microsoft.Cache, and Microsoft.DocumentDB. Register missing ones
with `az provider register --namespace <provider>` before applying.

The wrapper discovers the signed-in user's object ID/login for SQL administration.
It asks for a MongoDB administrator password through a secure prompt. Keep that
password in your password manager and reuse it on subsequent deployments; the
template does not generate a new password on each run. It passes the password in
the child-process environment, not command-line arguments or generated files.
DocumentDB Free assigns its own administrator username; the connection secret
uses the service-returned username rather than assuming `kumoadmin`. The username
parameter applies to an explicitly selected paid tier.

From the repository root:

```powershell
az login

# Defaults to the currently selected subscription. Preview creates no resources.
pwsh -NoProfile -File infra/azure/Deploy-KumoEnvironment.ps1 `
    -EnvironmentName kumo-dev -Location japaneast

# Apply the reviewed plan. This creates billable resources.
pwsh -NoProfile -File infra/azure/Deploy-KumoEnvironment.ps1 `
    -EnvironmentName kumo-dev -Location japaneast -Apply
```

Use `-SubscriptionId` to target another subscription explicitly. For a SQL admin
group/application or automation login, supply `-SqlAdministratorObjectId`,
`-SqlAdministratorLogin`, and `-SqlAdministratorType`. The SQL admin principal also
receives scoped bootstrap data roles by default; the main template exposes
separate `bootstrapPrincipalId`/`bootstrapPrincipalType` parameters if required.
Add `-AdministratorIpAddress` with your public IPv4 address to administer SQL or
MongoDB from your computer. Addresses must be individual IPv4 values, not CIDRs.
The default empty list permits Azure-service connections but no developer
Internet addresses. IP entries are carried through the parameter file using
`KUMO_ADMIN_IP_ADDRESSES_JSON`.

Nonsecret resource defaults and advanced parameters live in `main.bicep` and
`new-environment.bicepparam`. The wrapper defaults to `kumo-dev` and `japaneast`.
The parameter file can also be used directly with Azure CLI; required environment
variables are `KUMO_SQL_ADMIN_OBJECT_ID`, `KUMO_SQL_ADMIN_LOGIN`, and
`KUMO_MONGO_ADMIN_PASSWORD`. Optional variables are `KUMO_ENVIRONMENT_NAME`,
`KUMO_LOCATION`, and `KUMO_SQL_ADMIN_TYPE`. Clear credentials from your shell after
use. The wrapper restores any previous environment variables when it finishes.

The default profile prioritizes free/low-cost development:

| Service | Default | Cost/availability limit |
| --- | --- | --- |
| SQL | General Purpose serverless, 0.5–2 vCores, `useFreeLimit=true` | Pauses at the monthly free allowance; no automatic paid overages |
| MongoDB sessions | `Free`, 32 GB, no HA | One free cluster per subscription, supported regions only; no backup/restore |
| App Configuration | `free` | Free-tier capacity/request and per-region store limits apply |
| Redis | `Balanced_B0`, no HA | Paid; one private endpoint remains |
| Registries | Two `Basic` registries | Paid; separate platform/customer image namespaces are preserved |
| API | Consumption, 0.5 vCPU/1 GiB, min=max=1 | Kept running for durable workers; compute is not guaranteed free |
| Frontend | Consumption, 0.25 vCPU/0.5 GiB, min=0/max=2 | Scales to zero; smaller resources need workload testing |
| Stored logs | Off (`enableLogAnalytics=false`) | Live log streaming works; no persisted log history by default |
| Key Vault | Standard | Operations are billable; identities and RBAC do not eliminate service charges |

Free-tier creation failures never silently select paid resources. Explicitly
change `mongoComputeTier`, `configurationSku`, or `sqlUseFreeLimit` only if you
want paid capacity. SQL's background workers/persistent connections can consume
the free allowance even with little user traffic. AutoPause controls SQL spending
by sacrificing availability when the allowance runs out. Free eligibility and
quotas are not guaranteed by the template, and the overall stack is **not free**.
Check availability, budget, resilience, and compatibility before applying.

**Current-subscription check (2026-11-07):** the new-stack preview in Japan East
was rejected because this subscription permits only one Container Apps
environment there, and the existing installation already occupies it. Choose a
different supported region with `-Location`, another subscription with
`-SubscriptionId`, or obtain a quota increase before creating another stack.
This subscription's existing `kumo-mongo` also already uses DocumentDB Free,
which occupies its one-free-cluster allowance. A second free Mongo cluster needs
a different subscription or a freed allowance; selecting a paid tier is an
explicit choice. The template does not silently reuse or replace either old
service to bypass a limit. No resources were created by the preview.

## Complete runtime bootstrap

The apply command saves **nonsecret** outputs to
`infra/azure/.local/<environmentName>.outputs.json`. This directory is ignored.
Use those outputs rather than entering generated resource names yourself.

1. Initialize SQL from an explicitly firewall-allowed host, signed in with Azure
   CLI as the configured SQL Entra administrator. With private SQL enabled, the
   host additionally needs private-network/DNS access. Install this repo's npm
   dependencies on that host, then run:

   ```powershell
   node infra/azure/Initialize-KumoSql.mjs --outputs infra/azure/.local/kumo-dev.outputs.json
   ```

   This creates an external contained user using the runtime principal's SID,
   without a directory lookup, and grants read/write and dbo schema migration
   permissions. It refuses an existing user mapped to another identity. It does
   not grant db_owner. SQL migrations still run during API startup. Under the
   default public firewall profile, allow your administrator IPv4 address before
   running it. With private SQL, an ordinary Internet laptop/Cloud Shell still
   needs VPN, peering, or a connected administration host.

2. Upload `session-secret`, `stripe-secret-key`, `github-oauth-secret`, and
   `github-webhook-secret` into the generated vault. Use Azure CLI `az keyvault
   secret set --file` with an appropriately protected local secret file; do not put
   real credentials in a committed parameter file. Mongo and Redis connection
   secrets are provisioned by the template. Azure RBAC may need time to propagate
   before initial data-plane operations work.

3. Import the GitHub App's **matching existing private key** into Key Vault Keys
   with `az keyvault key import`, under `github-app-signing` (or the configured
   `githubSigningKeyName`). Creating an unrelated RSA key will not authenticate
   that GitHub App. Creating/authorizing the external GitHub App is separate.

4. Set nonsecret `integrationSettings` in the parameter file: at least
   `GITHUB_OAUTH2_CLIENT_ID` and the existing pipeline's `AZURE_DEVOPS_ORGANIZATION`,
   `AZURE_DEVOPS_PROJECT`, and numeric-string `AZURE_DEVOPS_PIPELINE_ID`. The backend
   currently requires pipeline coordinates at startup even though this template
   does not configure Azure DevOps or its IAM. If those are intentionally deferred,
   keep applications disabled. Optional `GITHUB_APP_CLIENT_ID` can differ from the
   OAuth fallback. Configure the GitHub OAuth callback to the generated frontend
   URL plus `/api/auth/callback`. Domain/DNS setup is not required for generated
   Container Apps hostnames.

5. Build and push the API/web images into the generated **platform** registry
   using the existing Dockerfiles and repository-root context. The bootstrap
   operator has Repository Writer and Catalog Lister on that registry. Customers'
   builds must use the other registry. No GitHub Actions or Azure DevOps identity,
   federation, pipeline, or service connection is created here.

6. Change `deployApplications` to `true` in the parameter file and supply `apiImage`
   and `webImage` with real SHA-tagged/digest-pinned image references. Repeat preview
   and apply with the same environment name/password. The API uses a user-assigned
   runtime identity selected through `AZURE_CLIENT_ID`; the pull identity is hidden
   from application code with lifecycle None. API minimum/maximum replicas are one
   because its durable workers run in-process. Probe '/' confirms HTTP startup;
   it does not prove all downstream dependencies or permissions are healthy.

   The frontend explicitly runs with `NODE_ENV=production`, `PORT=3000`, and
   `HOSTNAME=0.0.0.0`, with `API_URL` pointing to this environment's backend.
   Subscription management uses the authenticated backend routes in deployed
   environments; demo subscriptions are limited to local development. No
   subscription demo configuration variable is required.

Do not put secret values in `integrationSettings`: use the
`integrationVaultReferences` key-to-secret-name map. References take precedence
over plain settings with the same key. The infrastructure-generated SQL/Azure/URL
settings take precedence over caller-supplied settings. Disabling an optional
integration requires removing its unused Key Vault reference as well; the
configuration provider resolves every configured reference at startup.

## Boundaries and validation

Infrastructure success is not application readiness. Authenticate, verify cookie
forwarding, test SQL migrations, cache/session expiry, GitHub signing, and normal
workload operations after enabling apps. Mongo currently uses native admin
credentials for the session connection; a dedicated database user is a later
hardening step. No application data, users, subscriptions, or plan mappings are
copied from another environment.

The shared network is not tenant-private. Customer apps created in the same
environment can reach Redis's private endpoint, and public SQL/Mongo allow Azure
traffic from other subscriptions too; database credentials/identities
provide authorization. Runtime IAM still has subscription-scoped app/storage/RG
operations because the provider creates user groups dynamically; it does not
enforce `user-rg-*` ownership in Azure RBAC. A separate stack in the same
subscription is not a security boundary against the existing API's broad resource
operations. See `azure-iam.md` for that limitation. User workload storage remains
dynamic and its SMB data grants/bootstrap are separate; no unused central
`kumostore` or subscription-wide SMB role is provisioned.

Local checks: Bicep compilation and bootstrap script syntax checks passed. ARM
template-only validation also passed; it checks deployment structure without creating resources.
The wrapper's actual provider preview reached Azure and was blocked by the
existing Japan East environment quota, as described above. Template validation
does not verify regional capacity, runtime permissions, service-issued Mongo
connection-string formats, private DNS connectivity, or a complete deployment.
The new stack has not been deployed or tested end-to-end.

References: [DocumentDB private endpoints](https://learn.microsoft.com/en-us/azure/documentdb/how-to-private-link),
[Managed Redis private endpoints](https://learn.microsoft.com/en-us/azure/redis/private-link),
[SQL external-user SID syntax](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql),
[ACR repository roles](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions).

Tier references: [SQL free allowance and AutoPause](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier),
[DocumentDB Free limits](https://learn.microsoft.com/en-us/azure/documentdb/free-tier),
[App Configuration tiers](https://learn.microsoft.com/en-us/azure/azure-app-configuration/faq),
[Managed Redis network controls](https://learn.microsoft.com/en-us/azure/redis/secure-azure-managed-redis),
[Container Apps log storage options](https://learn.microsoft.com/en-us/azure/container-apps/log-options).
