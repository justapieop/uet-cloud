# Database seeding

Both database commands run independently of the API server. The server can remain stopped. They use `build:db` to compile only domain, application, and infrastructure workspaces, then open their own TypeORM connection and close it on completion. They do not build or bootstrap `apps/api` or `packages/presentation`, and do not require Redis, an HTTP listener, or running workers. Database connectivity and Azure SQL authentication are still required.

Run from the repository root with Node.js 24 and installed workspace dependencies:

```sh
npm run seed:db
npm run seed:db -- --data path/to/seed.json
```

The command builds the backend, connects to the configured database, applies registered migrations, then seeds data in one transaction. It does not start the API, workers, Azure provisioning, or Stripe operations. A failed seed rolls back its data writes; migrations already applied remain applied. Concurrent seed runs serialize their data writes using a SQL Server transaction application lock.

The command reads environment variables and the root `.env` (existing process variables take precedence). Supply `DATABASE_CONNECTION_URL`, or all of `DATABASE_URL` (host), `DATABASE_PORT`, and `DATABASE_NAME`. As in the API, authentication uses `azure-active-directory-default`: sign in with the Azure developer identity or use the deployment's managed identity. `DATABASE_ENABLE_ENCRYPTION` defaults to `true`. The command reads database settings directly; it does not load settings from Azure App Configuration. Its identity needs migration and insert permissions on the target database. It does not create a database.

## Built-in roles

| Stable role ID | Initial grants |
| --- | --- |
| `viewer` | DeploymentRead, BuildRead, DeploymentMetricsRead |
| `developer` | Viewer grants plus DeploymentCreate, DeploymentUpdate, DeploymentDelete |
| `admin` | Super |

These seeded roles start active and require explicit assignment. Separately, new OAuth users automatically receive role ID `default`, self-seeded during signup with name `Default` and the same initial grants as Developer. Signup also self-seeds the unassigned `super` role with name `Super` and only the Super permission, preserving an existing role's grants and activity. The `super` role is separate from the seeded `admin` role and is not assigned by `admin:add`. These signup roles need no seed command; existing settings are preserved and an inactive default blocks new registration. Existing users and offline administrators are not backfilled. See [default signup role](permissions.md#default-signup-role). Existing rows are preserved by ID, with one exception: the `admin` role always receives the Super bit if missing, preserving its other bits and active flag. Rerunning does not reactivate roles, alter other role grants, update prices, replace Stripe links, or duplicate assignments. Change other existing configuration through a separate deliberate update. New catalog permissions are not automatically added to the viewer/developer roles.

## Add an administrator by GitHub ID

```sh
npm run admin:add -- --github-id 123456
```

Supply the numeric GitHub account ID, not the username. OAuth uses this ID directly as `users.id`. The command shares the seed command's environment and database configuration, applies pending migrations, then creates/promotes the user in a transaction. It creates an active `admin` role with Super if absent, or adds Super to an existing active admin role, preserving other bits. Assignment is idempotent and preserves the user's other roles. Concurrent bootstrap commands serialize their writes.

For a missing user, this offline bootstrap creates an active, unsuspended database row using the GitHub ID as its display name, with no Stripe Customer link. The normal OAuth login flow establishes that link on first login; the script performs no GitHub or Stripe network calls and does not verify account existence. Use a known GitHub ID. Existing display names and Stripe links are preserved. The command refuses inactive/suspended users or a disabled admin role rather than reactivating them. Its database identity also needs update permission to add a missing Super bit.

Super grants permission checks; ownership, subscription, and quota checks still apply. Running the script does not create an authenticated session.

## Optional plans and assignments

Copy and edit [`scripts/seed-data.example.json`](../scripts/seed-data.example.json). Its price and quotas are illustrative, not finalized product requirements. The example plan starts inactive and unmapped. Configure the real Stripe Product ID and intended quotas and set `active` before the initial insert when ready. Seeding does not verify that Stripe products exist or register subscriptions.

The JSON root accepts `plans` and `assignments` arrays. Both are optional. Plan fields match the domain's `PlanDetails`; memory is GiB and must equal twice vCPU. CPU/RAM and maxReplicas are per deployment; deployments is the deployment-count quota. Disk is stored for future storage enforcement. Missing `active` defaults to true, `maxReplicas` to one, and `stripeProductId` to null. Prices must fit SQL decimal(19,4). Permission definitions remain in code; their bits are stored on roles.

To grant an existing user a role, explicitly include the user's database ID, for example:

```json
{
  "assignments": [
    { "userId": "123", "roleId": "developer" }
  ]
}
```

Only the three built-in role IDs are accepted. Users must already exist, be active, and be unsuspended; sign in through the normal OAuth flow first. Assign `admin` only by explicitly requesting it in this file. Seeding does not create users or Stripe Customers, and role grants do not bypass subscription, quota, or ownership checks. Disabled existing roles remain disabled even if assigned.

Validation runs before the connection is opened; data-dependent errors (missing users, conflicting Stripe Product IDs) abort the seed transaction. The command reports created-row counts and exits nonzero on failure without printing database credentials or driver query details.
