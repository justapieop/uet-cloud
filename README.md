# Cloud PaaS project

This project is building an Azure-hosted platform for developers and platform teams to deploy applications using Azure Container Apps. The [project brief](docs/llm/project-brief.md) describes the confirmed product direction, and the [decision log](docs/llm/decisions/README.md) records project-wide choices.

## Current repository state

The repository currently contains an npm package manifest, lockfile, and TypeScript configuration. The package is named `kumo` and uses ECMAScript modules. NestJS application code, Azure SDK dependencies, and npm scripts for building or running the application have not been added yet.

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
