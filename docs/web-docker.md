# Web Docker image

The frontend uses Next.js with server-side routes, authentication, and API requests. Its image runs the Next.js standalone Node server, including the traced production dependencies, public assets, and `.next/static` files. It is not a static export.

Build from the repository root so Docker can access the workspace lockfile and shared packages:

```sh
docker build -f apps/web/Dockerfile -t kumo-web:local .
```

The builder uses Node 24 on Debian 13 and installs development and optional dependencies for the web, REST client, and domain workspaces. Optional packages include the native Next.js, Tailwind, and TypeScript dependencies. The web build's existing `prebuild` compiles the REST client. Google Fonts used by `next/font/google` require outbound network access during the build.

The runtime uses `gcr.io/distroless/nodejs24-debian13:nonroot`, starts `apps/web/server.js` directly, and listens on `0.0.0.0:3000`. The monorepo tracing root in `apps/web/next.config.ts` ensures standalone output includes required dependencies outside the frontend workspace. Static and public assets are copied separately because standalone output does not include them automatically. Files are owned by the non-root runtime user so Next.js can write its cache.

Supply the backend URL at runtime:

```sh
docker run --rm --name kumo-web -p 3001:3000 \
  -e API_URL=https://your-api.example.com \
  kumo-web:local
```

Open `http://localhost:3001`. `API_URL` is the backend address reachable from the frontend container; its default `http://localhost:3000` would refer to the frontend container itself. The current server-side API layer reads `API_URL` at runtime. No API secrets or `.env` files are baked into the image. If browser-side `NEXT_PUBLIC_*` configuration is added later, Next.js embeds those values during compilation, so runtime variables will not replace them.

For Azure Container Apps, set ingress target port to `3000`, provide `API_URL` as a runtime environment variable, and configure the backend's `FRONTEND_URL` and GitHub OAuth settings for the public frontend address. This image does not load Azure App Configuration directly. When using the Azure deployment action, set `appSourcePath: ${{ github.workspace }}` and `dockerfilePath: apps/web/Dockerfile`. No frontend publishing workflow is added by this Dockerfile.

Browser authentication uses the frontend `/api/auth/*` Route Handler, which reads `API_URL` at runtime and forwards login/callback/installation redirects and session cookies. Configure the GitHub OAuth callback on the frontend origin at `/api/auth/callback`, with the same value in the backend's `GITHUB_OAUTH2_REDIRECT_URL`. Keep the backend session cookie host-only and configure its ingress proxy trust. No Docker build argument or Next.js rewrite is required for the backend URL. See [frontend authentication proxy](configuration.md#frontend-authentication-proxy) for production values and verification.
