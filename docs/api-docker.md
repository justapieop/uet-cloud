# API Docker image

Build the API image from the repository root, using the committed npm lockfile:

```sh
docker build -f apps/api/Dockerfile -t kumo-api:local .
```

The Dockerfile builds with Node 24 on Debian Trixie slim and runs on `gcr.io/distroless/nodejs24-debian13:nonroot`. Both stages use Node 24 and Debian 13. The build stage installs the backend workspaces and compiles them through `npm run build:api`. A separate production dependency stage omits development and optional packages. Install scripts are disabled; the current backend dependency tree requires no install-time code generation or native builds. Revisit this flag if a future backend dependency requires an installation script.

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
