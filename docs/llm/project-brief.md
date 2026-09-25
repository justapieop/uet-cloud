# Project brief

## Objective

Build a cloud-integrated Platform as a Service (PaaS) that lets developers and platform-oriented teams deploy applications using Azure Container Apps (ACA).

## Intended users

- Developers
- DevOps practitioners
- MLOps practitioners
- Related platform and operations roles

## Confirmed direction

- Azure Container Apps is the deployment platform for applications deployed through the PaaS.
- The PaaS itself will be hosted on Azure.
- Azure SQL Database is the persistence database for the project.
- The codebase will use Clean Architecture for organization and future scaling.
- The platform application will use TypeScript with NestJS; npm is the package manager.
- The project is a monorepo that includes a frontend application serving as the client for the PaaS.
- npm workspaces place the thin NestJS server entry point in `apps/api` and the frontend client in `apps/web`. NestJS bootstrap and module composition live in `packages/presentation`. Separate packages hold the domain, application/use-case, infrastructure, and presentation boundaries. `packages/contracts` and `infra/azure` are reserved for shared API contracts and Azure deployment configuration.
- `NODE_ENV` and `KUMO_CONFIG_SOURCE` independently select the API runtime environment and configuration source. `NODE_ENV` defaults to production. `KUMO_CONFIG_SOURCE` defaults to Azure when unset; `local` loads `.env`, while `azure` loads App Configuration settings and resolves Key Vault references using an Azure identity.

## Source-of-truth note

The README provides a setup guide and links to this brief. Use this brief and the LLM guidance in [`project-instructions.md`](project-instructions.md) for current project context and technical conventions.

## Open questions

The product scope, supported deployment inputs, user journey, tenancy model, Azure service choices beyond ACA, frontend technology, communication between applications, and operational requirements have not yet been established here. Treat these as open until decided.
