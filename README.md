# Cloud PaaS project

This project is building an Azure-hosted platform for developers and platform teams to deploy applications using Azure Container Apps. The [project brief](docs/llm/project-brief.md) describes the product direction, and [LLM project instructions](docs/llm/project-instructions.md) provide technical conventions.

The project is an npm workspaces monorepo with a frontend application serving as the PaaS client.

## Current repository state

The root package is named `kumo` and uses ECMAScript modules. The repository currently has this layout:

```text
apps/api/                 NestJS server entry point and composition root
apps/web/                 Frontend client skeleton
packages/domain/          Business rules and domain models
packages/application/     Use cases and application ports
packages/infrastructure/  External system adapters
packages/presentation/    Transport adapters
packages/contracts/       Shared API contract placeholder
infra/azure/              Azure deployment configuration placeholder
docs/llm/                 Project brief and LLM-specific guidance
```

The API has a TypeScript configuration and [server skeleton guidance](apps/api/README.md); frontend tooling will be chosen with its framework. `@kumo/domain` now contains a domain base, errors, and a `User` example; its construction conventions are documented in the [LLM project instructions](docs/llm/project-instructions.md). The other packages remain skeletons. NestJS and Azure SDK dependencies, deployment configuration, and run/build scripts have not been added yet.

## Local setup

Install Node.js and npm, then restore the dependencies recorded in the lockfile:

```sh
npm ci
```

There is no application start command yet. The current development dependencies are TypeScript and Node.js type definitions.

## Project guidance

- [Product brief](docs/llm/project-brief.md)
- [LLM project instructions](docs/llm/project-instructions.md)
- [Repository guidance for coding agents](AGENTS.md)
