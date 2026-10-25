# API Docker image

Build the API image from the repository root, using the committed npm lockfile:

```sh
docker build -f apps/api/Dockerfile -t kumo-api:local .
```

The final `.` must be the repository root. Using `apps/api` as the context makes `COPY package-lock.json`, `COPY apps/api/...`, and `COPY packages/...` fail with checksum or "not found" errors. Docker cannot copy files outside its build context. For `azure/container-apps-deploy-action`, set `appSourcePath: ${{ github.workspace }}` and `dockerfilePath: apps/api/Dockerfile`; the Dockerfile path does not select the build context.

The Dockerfile builds with Node 24 on Debian Trixie slim and runs on `gcr.io/distroless/nodejs24-debian13:nonroot`. Both stages use Node 24 and Debian 13. The build stage installs the backend workspaces, including development and optional dependencies, and compiles them through `npm run build:api`. TypeScript 7 requires its platform-specific optional compiler package (for example, `@typescript/typescript-linux-x64`); do not omit optional dependencies in the build stage. A separate production dependency stage omits development and optional packages, so the compiler is not included in the runtime. Install scripts are disabled; the current backend dependency tree requires no install-time code generation or native builds. Revisit this flag if a future backend dependency requires an installation script.

The runtime contains production dependencies, workspace manifests, and compiled backend output. Workspace directory paths are preserved, including any nested dependency directories, so `@kumo/*` imports resolve. The [distroless Node image](https://github.com/GoogleContainerTools/distroless/blob/main/nodejs/README.md) already supplies Node as its entrypoint, so the Dockerfile's JSON command supplies only `apps/api/dist/main.js`. It runs as the `nonroot` user; there is no runtime shell or npm. SIGTERM reaches Node and the existing Nest shutdown hooks. Source files, frontend code, test fixtures, and local environment files are not copied into the runtime image. The root `.dockerignore` also excludes credentials and local dependency/build directories from the build context.

The defaults are `NODE_ENV=production`, `CONFIG_SOURCE=azure`, and `PORT=3000`. For Azure configuration, provide the App Configuration endpoint at runtime and give the container's Azure identity access to the required configuration, Key Vault, SQL database, and Azure resources:

```sh
docker run --rm --name kumo-api -p 3000:3000 \
  -e AZURE_APPCONFIG_ENDPOINT=https://<configuration-store>.azconfig.io \
  kumo-api:local
```

The API retains its normal startup requirements, including SQL, Redis, MongoDB sessions, GitHub, Stripe, and Azure settings. On Azure Container Apps, configure the platform API's identity and set ingress target port to `3000` (or the overridden `PORT`). A local Docker container does not inherit the host's Azure CLI login; provide an Azure-supported credential through runtime environment variables or run under an Azure managed identity. Do not pass credentials as Docker build arguments or bake `.env` into the image.

To use a local configuration file without copying it into the image, pass its variables at runtime and select local configuration explicitly:

```sh
docker run --rm --name kumo-api -p 3000:3000 \
  --env-file .env -e CONFIG_SOURCE=local -e NODE_ENV=production -e PORT=3000 \
  kumo-api:local
```

Database, Redis, and MongoDB addresses must be reachable from inside the container; container-local `localhost` does not refer to the host. The container user can write temporary build-source archives to `/tmp`. Application code and installed dependencies remain owned by root. No HTTP healthcheck is invented by the image; configure deployment probes according to the API's available routes and dependency startup time. The API runs migrations at startup, so its database identity retains the existing migration permission requirement.

## Publish to ACR with GitHub Actions

`.github/workflows/kumo-api-AutoDeployTrigger-bd49aca2-d2ab-40d7-b1ce-71af38c470bb.yml` runs on pushes to `main` or **Actions > Trigger auto deployment for kumo-api > Run workflow**. It uses `azure/container-apps-deploy-action@v2` with repository-root `appSourcePath` and explicit `dockerfilePath: apps/api/Dockerfile`. Docker builds the final distroless `runtime` stage, and the action pushes `kumoreg.azurecr.io/kumo-api:<full-git-commit-sha>` and deploys it to `kumo-api` in `kumo-rg`.

Configure these GitHub repository settings under **Settings > Secrets and variables > Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `KUMOAPI_AZURE_CLIENT_ID` | Client ID of the workflow's Entra application or user-assigned managed identity |
| Secret | `KUMOAPI_AZURE_TENANT_ID` | Microsoft Entra tenant ID |
| Secret | `KUMOAPI_AZURE_SUBSCRIPTION_ID` | Subscription containing the existing Container App |
| Secret | `KUMOAPI_REGISTRY_USERNAME` | Registry push username |
| Secret | `KUMOAPI_REGISTRY_PASSWORD` | Corresponding registry push password/token |

Configure an Azure [OIDC federated credential](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) on that identity with issuer `https://token.actions.githubusercontent.com` and audience `api://AzureADTokenExchange`. GitHub repositories created after July 15, 2026 use an [immutable subject format](https://docs.github.com/en/actions/reference/security/oidc) that includes owner and repository IDs. For `justapieop/uet-cloud`, use `repo:justapieop@57786194/uet-cloud@1366921434:ref:refs/heads/main`. In Azure's GitHub form, Organization is `justapieop`, Organization ID is `57786194` (the personal account ID), Repository is `uet-cloud`, Repository ID is `1366921434`, Entity is Branch, and Branch is `main`. Older repositories may retain the legacy `repo:<owner>/<repository>:ref:refs/heads/main` format unless opted in, renamed, or transferred; match the subject actually issued for the repository. The job requests `id-token: write`; no Azure client secret is needed for Azure login. Docker registry authentication uses the separate registry username/password secrets.

The workflow uses OIDC for Azure Resource Manager and the registry username/password secrets for Docker registry authentication. The registry credentials need push access to the selected repository. If they represent an Entra principal, that normally means registry-scoped `AcrPush` for an RBAC-only registry or `Container Registry Repository Writer` for an ABAC-enabled registry. See [ACR's RBAC/ABAC roles](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions). A registry available only on a private network needs a runner with network access.

Grant the OIDC identity named by `KUMOAPI_AZURE_CLIENT_ID` **Container Apps Contributor** on the existing app's resource group. This workflow identity is separate from the API's runtime system identity. If assigning/updating attached user-assigned identities requires it, grant **Managed Identity Operator** on those identities too. The app's existing registry pull identity or credentials must still permit image pulls.

The Azure deployment action manages the deployment operation and can provision missing resources. Its permission requirements can therefore extend beyond updating an existing app, including managed environment or Log Analytics workspace creation. The current workflow does not implement a separate image-only update or revision-readiness polling loop. Configure suitable startup/readiness probes and ensure the API's `PORT` matches ingress/probe target ports; the Dockerfile defaults to 3000.

These GitHub secrets are independent of the API's `.env` and Azure App Configuration. The Azure Pipelines flow for users' applications remains separate. This workflow deploys images it builds and pushes; arbitrary pushes from other registry clients require a separate ACR event consumer.
