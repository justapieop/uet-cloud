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
- Source builds use a Dockerfile from a GitHub repository. Azure Pipelines builds and pushes images to ACR; ACR stores images. Automatic rebuild triggers remain an open decision.
- Private repository access uses GitHub App installation tokens limited to selected repositories with Contents read permission. The infrastructure GitHub provider manually constructs an app JWT, signs it through the existing Azure Key Vault KMS provider, and exchanges it for a token without persisting it.
- `POST /deployment/build` persists a pending build and immediately returns HTTP 202 with a build ID and image address; commit SHA and pipeline run information are initially null. A database-backed worker inside the API claims pending builds, checks the requesting user's GitHub repository access, resolves the requested reference, and schedules Azure Pipelines. An owner-scoped build query reports preparation failures through an `error` field and refreshes scheduled pipeline status on demand. Pending work survives restarts; interrupted preparation is marked failed after ten minutes and is not automatically scheduled again. A secret per-build credential authorizes the pipeline to fetch the manifest and source directly from Kumo. Only the credential hash is stored by Kumo, and GitHub credentials stay in the backend. The pipeline downloads the saved commit, builds, and pushes the image. Automatic ACA deployment after build completion remains unimplemented.
- The PaaS itself will be hosted on Azure.
- Azure SQL Database is the persistence database for the project.
- The API uses Microsoft Entra passwordless authentication for Azure SQL Database.
- The codebase will use Clean Architecture for organization and future scaling.
- The platform application will use TypeScript with NestJS; npm is the package manager.
- The project is a monorepo that includes a frontend application serving as the client for the PaaS.
- The frontend client follows Feature-Sliced Design (FSD) within `apps/web`.
- npm workspaces place the thin NestJS server entry point in `apps/api` and the frontend client in `apps/web`. NestJS bootstrap and module composition live in `packages/presentation`. Separate packages hold the domain, application/use-case, infrastructure, and presentation boundaries. `packages/contracts` and `infra/azure` are reserved for shared API contracts and Azure deployment configuration.
- `NODE_ENV` and `CONFIG_SOURCE` independently select the API runtime environment and configuration source. Both can come from the process environment or repository-root `.env`, with the process value taking precedence. `NODE_ENV` defaults to production. `CONFIG_SOURCE` defaults to Azure when unset; `local` loads `.env`, while `azure` loads App Configuration settings and resolves Key Vault references using an Azure identity.
- Feature flags load from Azure App Configuration at startup and refresh every 12 hours. The local configuration source provides an empty feature flag list.
- User application isolation: Applications deployed through the platform run as Azure Container Apps inside dedicated user Resource Groups named `user-rg-<userId>`. Deployments into the system Resource Group are strictly forbidden.
- Shared ACA Managed Environment: Container Apps across all user Resource Groups connect to a central shared Managed Environment (referenced by `AZURE_CONTAINER_APP_ENV_ID`) in the system Resource Group within the same Azure region (`eastasia`).
- Deployment engine separation: The Deployment feature is split into a Provisioning & Mutation Engine (handling `POST /deployments` and `PATCH /deployments/:id`) and a Data, Monitoring & Teardown Engine (handling `GET` queries and `DELETE` teardown).

## Source-of-truth note

The README provides a setup guide and links to this brief. Use this brief and the LLM guidance in [`project-instructions.md`](project-instructions.md) for current project context and technical conventions.

## Open questions

The remaining product scope, deployment inputs beyond GitHub repositories with Dockerfiles, user journey, tenancy model beyond the current shared environment, additional Azure service choices, frontend framework, communication between applications, and operational requirements remain open. Treat these as open until decided.
