# Project instructions for LLMs

## Project

This project is building a cloud-integrated Platform as a Service (PaaS) for developers and platform-oriented teams, including DevOps and MLOps practitioners. The platform enables users to deploy applications using Azure Container Apps (ACA).

The platform itself is intended to be hosted on Azure. Organize its code using Clean Architecture to support clear boundaries and future growth.

The codebase is an npm workspaces monorepo with `apps/api` as a thin NestJS server entry point and `apps/web` as the frontend client. NestJS bootstrap and module composition live in `packages/presentation`. `packages/domain`, `packages/application`, `packages/infrastructure`, and `packages/presentation` hold the Clean Architecture boundaries. `packages/contracts` and `infra/azure` are reserved for shared contracts and Azure deployment configuration. The frontend technology remains an open decision.

Keep use cases under `packages/application/src/use-cases`. Group related code by feature within each package as features are defined. Domain code must not depend on NestJS or Azure SDKs; the application package depends inward on domain concepts, while infrastructure and presentation implement outside adapters. Define infrastructure modules alongside their providers in `packages/infrastructure`; compose them in the presentation root module and invoke the presentation bootstrap from `apps/api`.

Every domain definition in `@kumo/domain` must extend the `Domain<TDetails>` base class exported from `src/domain.ts` through `src/index.ts`. Each concrete domain must expose one public constructor argument named `details`, typed by its corresponding `*Details` interface, and pass it to `super(details)`. The base class stores the details and calls `validate()` during construction, so validation must read stored details rather than subclass fields initialized after `super()` returns. `validate()` returns `InvalidDomainParams` for invalid construction data and `null` when valid. `InvalidStateTransition` is reserved for state validation and transition failures; its behavior is not yet implemented. Keep imports acyclic: domain files import the base from `src/domain.ts`, while `src/index.ts` re-exports the base and concrete domains.

Each permission definition in the role domain must include a stable zero-based `offset`, `name`, and `description`. Compute its mask as `1n << BigInt(offset)` when needed; do not store a precomputed mask or reuse/renumber an assigned offset. `Role.hasPermission()` grants any requested permission when the role has the `Super` bit, otherwise it checks the requested permission's bit. `Role.getGrantedPermissions()` returns known definitions granted by the role, and a role with `Super` receives every definition in the catalog. Metadata does not control access. Unknown stored bits have no catalog entry and are omitted. Resource or tenant scope checks are separate and are not specified here.

Do not write anything into README.md until told to do so.

## Source of truth

- Treat [`project-brief.md`](project-brief.md) as the concise, current product brief.
- Treat the `README.md` as repository setup and status guidance. The project brief and these instructions define product direction and technical conventions.
- Conversation context can establish or refine direction. When a project-wide direction is confirmed, update the relevant brief or these instructions so future conversations can use it.

## Working guidance

- Explicitly annotate every TypeScript variable declaration (`const`, `let`, or `var`), including exported constants. Do not rely on type inference for variables or use `any` as a substitute for a meaningful type.
- Keep external dependencies used by `packages/infrastructure` and `packages/presentation` in the root `package.json`. Those workspaces declare only their `@kumo/*` package dependencies; the root lockfile records the resolved versions.
- Keep product intent, architectural choices, and implementation details distinct. Do not present an idea or assumption as a confirmed decision.
- Consider the effect of proposals on the PaaS as a whole, including its frontend client, users, Azure hosting, ACA deployment workflow, and Clean Architecture boundaries.
- Do not infer specific Azure services, languages, frameworks, tenancy models, deployment flows, or security requirements unless the user or project documents establish them.
- Keep this instruction file focused on durable LLM guidance and technical conventions. Put product facts in the project brief.
