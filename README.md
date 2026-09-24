# Cloud PaaS project

This project is building an Azure-hosted platform for developers and platform teams to deploy applications using Azure Container Apps. The [project brief](docs/llm/project-brief.md) describes the confirmed product direction, and the [decision log](docs/llm/decisions/README.md) records project-wide choices.

The project is an npm workspaces monorepo with a frontend application serving as the PaaS client.

## Current repository state

The root package is named `kumo` and uses ECMAScript modules. The repository currently has this layout:

```text
apps/api/            NestJS platform app skeleton
apps/web/            Frontend client skeleton
packages/contracts/  Shared API contract placeholder
infra/azure/         Azure deployment configuration placeholder
docs/llm/            Project guidance and decisions
```

The workspaces contain package manifests and empty source directories. The API has a TypeScript configuration; frontend tooling will be chosen with its framework. No application code, NestJS or Azure SDK dependencies, deployment configuration, or run/build scripts have been added yet.

## Local setup

Install Node.js and npm, then restore the dependencies recorded in the lockfile:

```sh
npm ci
```

There is no application start command yet. The current development dependencies are TypeScript and Node.js type definitions.

## Project guidance

- [Product brief](docs/llm/project-brief.md)
- [Confirmed decisions](docs/llm/decisions/README.md)
- [Repository guidance for coding agents](AGENTS.md)
