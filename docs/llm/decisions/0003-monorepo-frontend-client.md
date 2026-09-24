# D-0003: Monorepo with a frontend client

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The PaaS needs a client application alongside its platform services. The user confirmed that these belong in one repository.

## Decision

- Organize the project as a monorepo.
- Include a frontend application that acts as the client for the PaaS.

## Consequences

- Future repository structure and tooling should accommodate the frontend and platform applications together.
- The frontend framework, workspace tooling, package layout, and communication between applications remain to be decided.
