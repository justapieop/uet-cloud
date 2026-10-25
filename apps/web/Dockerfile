# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f apps/web/Dockerfile -t kumo-web .
FROM node:24-trixie-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/rest/package.json ./packages/rest/
COPY packages/domain/package.json ./packages/domain/

# Next.js, Tailwind, and TypeScript require platform-specific optional packages.
RUN npm ci --include=dev --include=optional --ignore-scripts --no-audit --no-fund \
    --include-workspace-root \
    --workspace=apps/web \
    --workspace=packages/rest \
    --workspace=packages/domain

FROM dependencies AS build
COPY tsconfig.json ./
COPY packages/domain/tsconfig.json ./packages/domain/
COPY packages/domain/src ./packages/domain/src
COPY packages/rest/tsconfig.json ./packages/rest/
COPY packages/rest/src ./packages/rest/src
COPY apps/web/ ./apps/web/

# The web prebuild script compiles @kumo/rest before Next.js builds the app.
RUN npm run build --workspace=packages/domain \
    && npm run build --workspace=apps/web \
    && mkdir -p apps/web/public

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Monorepo standalone output preserves apps/web and shared workspace paths.
COPY --from=build --chown=nonroot:nonroot /app/apps/web/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nonroot:nonroot /app/apps/web/public ./apps/web/public

USER nonroot:nonroot
EXPOSE 3000
STOPSIGNAL SIGTERM
# Distroless supplies the Node executable; no npm or shell is needed at runtime.
CMD ["apps/web/server.js"]
