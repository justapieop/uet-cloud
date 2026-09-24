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
- The codebase will use Clean Architecture for organization and future scaling.
- The application will use TypeScript with NestJS and npm as its package manager.

## Source-of-truth note

The README provides a setup guide and links to this brief. Use this brief, the LLM guidance in [`project-instructions.md`](project-instructions.md), and the confirmed records in [`decisions/`](decisions/) for current project context.

## Open questions

The product scope, supported deployment inputs, user journey, tenancy model, Azure service choices beyond ACA, and operational requirements have not yet been established here. Treat these as open until decided.
