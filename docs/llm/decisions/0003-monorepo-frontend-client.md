# D-0003: Monorepo with a frontend client

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The PaaS needs a client application alongside its platform services. The user confirmed that these belong in one repository.

## Decision

- Organize the project as a monorepo.
- Include a frontend application that acts as the client for the PaaS.
- Use npm workspaces with `apps/api` for the NestJS platform application and `apps/web` for the frontend client.
- Reserve `packages/contracts` for shared API contracts and `infra/azure` for Azure deployment configuration.

## Consequences

- The root package manages the workspaces and a single lockfile.
- The directory skeletons are placeholders; shared contracts and Azure deployment configuration will be added when needed.
- The frontend framework and communication between applications remain to be decided.
