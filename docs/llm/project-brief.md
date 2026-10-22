# Project brief

## Objective

Build a cloud-integrated Platform as a Service (PaaS) that lets developers and platform-oriented teams deploy applications using Azure Container Apps (ACA).

## Intended users

- Developers
- DevOps practitioners
- MLOps practitioners
- Related platform and operations roles

## Confirmed direction

- Permission-protected backend APIs share the existing plan/user routes (without an admin prefix) and manage local plans (list/read/create/full replacement/deactivation), inspect users' Stripe subscriptions, and schedule or undo period-end cancellation. They require PlanManage or SubscriptionManage respectively; existing Super admins receive both. Deactivating a plan affects subsequent eligibility without canceling subscriptions or deleting workloads. See [admin billing](../admin-billing.md).

- `GET /plans/me` lets an authenticated, active, unsuspended user check plan membership through live active Stripe subscriptions matched to active local plans. It returns `has_plan` and the matching public plan details, uses private no-store responses, and reports Stripe outages as 503 rather than falsely reporting no plan. It does not indicate remaining quota.

- `GET /plans` is a public catalog of active Stripe-linked local plans, exposing plan IDs, names, local prices, and quotas while omitting Stripe identifiers. It reads SQL without querying Stripe; Checkout remains authoritative for the billed price and product availability.

- `POST /plans/:id/subscriptions` allows an authenticated, active, unsuspended user with a linked Stripe customer to select only the local plan; the backend includes all active prices on its linked Stripe product, across all pages, including metered recurring and one-time initial charges. Client-supplied prices and other nonempty body fields are rejected. It returns a Stripe-hosted Checkout Session ID and URL, requires an idempotency key, and leaves deployment access dependent on Stripe reporting an active subscription. Success and cancellation return to the configured frontend dashboard. See [plan subscriptions](../plan-subscriptions.md).

- Database load reduction retains SQL-backed durable queues and transactional quota/idempotency guarantees. Idle queue polling backs off to ten seconds, stale sweeps run once per minute, and unchanged build states are not persisted repeatedly. Authentication reloads user eligibility and active role grants per request; running/stopped read caching is bounded to ten seconds and terminal build caching to thirty seconds. See [database load](../database-load.md).

- Deployment detail and list reads obtain applied CPU/RAM, replica limits, ports, region, image, and FQDN from Azure for provisioned resources. Saved creation inputs remain durable for queued work and quota reservations; workflow records retain identity, ownership, status, and errors. See [applied configuration](../deployment-configuration.md).

- Users and roles have an `active` boolean in the domain and database, defaulting to true for new and existing records. Permission-protected routes require an active, unsuspended user and combine only active assigned roles. A permission decorator requires all listed permission bits, with the established Super override.

- User-to-role assignments use a many-to-many `user_roles` link table. Each user/role pair is unique, and deleting either parent removes its links.

- Deployment names are globally unique across all users, enforced in the database.
- New deployment requests require an active subscription verified directly with Stripe using the user's linked Stripe Customer. Subscription product IDs map to active local plans through `plans.stripe_product_id`. Subscription registration is outside the current implementation scope.
- Plan CPU and RAM quotas apply per deployment (per-replica allocation), with a separate per-deployment maximum replica limit (`plans.max_replicas`). The plan's deployment-count quota includes queued and provisioning deployments as well as running apps. Storage is capped when it is added to an instance later; deployment creation does not allocate storage.

- Azure Container Apps is the deployment platform for applications deployed through the PaaS.
- New user managed environments use the standard Workload Profiles environment type with its Consumption profile. Existing Express environments require separate replacement or migration; the provider rejects them before building.
- Users can choose a deployment `region`. The first managed environment establishes that user's shared workload region; subsequent requests selecting a different region fail before building. Omitting the field reuses an existing environment or follows the default provisioning location. Azure still determines whether the subscription can deploy in the selected region.
- Source builds use a Dockerfile from a GitHub repository. Azure Pipelines builds and pushes images to ACR; ACR stores images. Automatic rebuild triggers remain an open decision.
- Image addresses use `<registry>/<name>:<tag>`, with the tag supplied in deployment input and no user namespace. Build tracking IDs remain separate generated UUIDs. The optional image name defaults to the app name.
- Private repository access uses GitHub App installation tokens limited to selected repositories with Contents read permission. The infrastructure GitHub provider manually constructs an app JWT, signs it through the existing Azure Key Vault KMS provider, and exchanges it for a token without persisting it.
- The temporary HTTP build trigger has been removed. Deployment creation queues a build through the internal build use case, which persists pending builds with initially null commit SHA and pipeline run information. A database-backed worker inside the API claims pending builds, checks the requesting user's GitHub repository access, resolves the requested reference, and schedules Azure Pipelines. An owner-scoped build query reports preparation failures through an `error` field and refreshes scheduled pipeline status on demand. Pending work survives restarts; interrupted build preparation is marked failed after ten minutes and is not automatically scheduled again. A secret per-build credential authorizes the pipeline to fetch the manifest and source directly from Kumo. Only the credential hash is stored by Kumo, and GitHub credentials stay in the backend. The pipeline downloads the saved commit, builds, and pushes the image.
- `POST /deployments` accepts an authenticated user's deployment request with HTTP 202. A database-backed deployment worker prepares user resources, builds the repository, waits for that build to succeed, and creates the Container App using its image. Owner-scoped `GET /deployments` and `GET /deployments/:id` report `PENDING`, `PROVISIONING`, `RUNNING`, or `FAILED`, including build ID, image, Azure resource ID, FQDN, and safe errors when available. Pending deployments survive restarts. Interrupted provisioning is marked failed after the configured operation timeout plus one minute; it is not automatically retried.
- Users choose `max_vcpu`, `max_memory` in GiB, `min_scaling`, and `max_scaling` when creating a deployment. CPU and memory are per-replica allocations with a strict 1:2 ratio: memory must equal twice vCPU. vCPU uses positive increments of 0.25. Scaling uses integer replica counts, allows zero minimum replicas, and requires a maximum of at least one with minimum no greater than maximum.
- Deployments support up to five additional TCP port mappings alongside the primary HTTPS target port. Additional ports default to access within the user's shared environment. Users may request external mappings when the existing managed environment has VNet integration; provisioning VNet infrastructure is not currently implemented. Requests and deployment responses include `additional_ports` mappings with `target_port`, `exposed_port`, and `external`.
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
- Per-user ACA Managed Environment: Each user has `user-aca-env-<userId>` inside `user-rg-<userId>`, shared by all of that user's Container Apps. Existing groups and environments are reused. Deployment creation rejects an existing app associated with a different deployment ID. Missing resources are created in Resource Group → Managed Environment → Container App order. For a new app, the GitHub Dockerfile build starts after environment readiness and must succeed before app creation. Failed or canceled builds never create an app.
- All ACR images are private. ARM provisioning uses `DefaultAzureCredential`. Container Apps pull images using an existing user-assigned managed identity with ACR pull permission; that identity is unavailable to tenant application code. The provider refuses new builds when the registry permits anonymous pulls.

## Pricing model

- Packages include a monetary usage allowance. In the user's example, a $5 package includes $5 worth of usage with no additional usage charge within that allowance. Usage exceeding the allowance is charged at the applicable resource rates.
- An illustrative CPU rate is $0.0001 per vCPU per instance per hour. At that rate, CPU usage value is allocated vCPU per instance multiplied by instance-hours multiplied by $0.0001, summed across instances. This is an example rate, not a finalized price catalog.
- Working interpretation: the package price is the base charge, and the total charge is package price plus `max(0, rated usage - included allowance)`. Confirm this interpretation before implementing billing.

## Source-of-truth note

The README provides a setup guide and links to this brief. Use this brief and the LLM guidance in [`project-instructions.md`](project-instructions.md) for current project context and technical conventions.

## Open questions

Pricing details still to confirm include the package billing period, allowance reset and rollover behavior, final resource rates, whether CPU metering uses allocated or consumed CPU, billing time granularity and rounding, and whether included usage and overages use the same rates.

The remaining product scope, deployment inputs beyond GitHub repositories with Dockerfiles, user journey, additional Azure service choices, frontend framework, communication between applications, and operational requirements remain open. Treat these as open until decided.
