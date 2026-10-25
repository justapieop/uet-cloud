# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f apps/api/Dockerfile -t kumo-api .
# The final '.' is the build context: apps/api alone excludes the root lockfile
# and shared packages. Azure Actions must use appSourcePath: github.workspace
# with dockerfilePath: apps/api/Dockerfile.
FROM node:24-trixie-slim AS manifests
WORKDIR /app

# Keep the workspace layout intact so npm's @kumo/* links resolve at runtime.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/domain/package.json ./packages/domain/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/application/package.json ./packages/application/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY packages/presentation/package.json ./packages/presentation/

FROM manifests AS build
# TypeScript 7 ships its native compiler as a platform-specific optional dependency.
RUN npm ci --include=dev --include=optional --ignore-scripts --no-audit --no-fund \
    --include-workspace-root \
    --workspace=apps/api \
    --workspace=packages/domain \
    --workspace=packages/contracts \
    --workspace=packages/application \
    --workspace=packages/infrastructure \
    --workspace=packages/presentation

COPY tsconfig.json ./
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY packages/domain/tsconfig.json ./packages/domain/
COPY packages/domain/src ./packages/domain/src
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY packages/application/tsconfig.json ./packages/application/
COPY packages/application/src ./packages/application/src
COPY packages/infrastructure/tsconfig.json ./packages/infrastructure/
COPY packages/infrastructure/src ./packages/infrastructure/src
COPY packages/presentation/tsconfig.json ./packages/presentation/
COPY packages/presentation/src ./packages/presentation/src
RUN npm run build:api

FROM manifests AS production-dependencies
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
    --include-workspace-root \
    --workspace=apps/api \
    --workspace=packages/domain \
    --workspace=packages/contracts \
    --workspace=packages/application \
    --workspace=packages/infrastructure \
    --workspace=packages/presentation

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_SOURCE=azure \
    PORT=3000

COPY --from=production-dependencies /app/ ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/application/dist ./packages/application/dist
COPY --from=build /app/packages/infrastructure/dist ./packages/infrastructure/dist
COPY --from=build /app/packages/presentation/dist ./packages/presentation/dist

USER nonroot:nonroot
EXPOSE 3000
STOPSIGNAL SIGTERM
# The distroless Node image already supplies the Node executable as ENTRYPOINT.
CMD ["apps/api/dist/main.js"]
