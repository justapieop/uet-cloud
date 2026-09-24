# D-0004: Clean Architecture packages and API composition root

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The initial API skeleton placed Clean Architecture layers inside `apps/api/src`. The user chose to make those boundaries individual npm workspace packages and reserve the API app for starting the server.

## Decision

- `apps/api` contains the NestJS server bootstrap and composition root.
- `packages/domain` holds business rules and domain models.
- `packages/application` holds use cases and application ports, with use cases under `src/use-cases`.
- `packages/infrastructure` holds implementations for external systems such as Azure and persistence.
- `packages/presentation` holds transport adapters such as NestJS HTTP controllers.
- `packages/contracts` remains the placeholder for API contracts shared with `apps/web`.

## Consequences

- Dependencies point inward: domain has no dependency on NestJS or Azure SDKs; application uses domain abstractions; infrastructure and presentation adapt the application; the API app assembles them.
- Feature directories may be added within the packages as features are defined.
- Package manifests and empty source directories establish the boundaries without implementing behavior yet.
