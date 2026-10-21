# Permission enforcement

## Catalog

Offsets are stable persisted bit positions. Existing roles retain their grants; adding definitions does not grant their bits automatically.

| Definition | Offset | Action | Prerequisite metadata |
| --- | --- | --- | --- |
| `Super` | 0 | All permissions; reserve for explicitly privileged roles | None |
| `DeploymentRead` | 1 | List and read owned deployments | None |
| `DeploymentCreate` | 2 | Queue a deployment and its build, subject to subscription and quotas | None |
| `DeploymentUpdate` | 3 | Update owned deployments | `DeploymentRead` |
| `DeploymentDelete` | 4 | Delete owned deployments and their resources | `DeploymentRead` |
| `BuildRead` | 5 | Read owned build status and pipeline details | None |
| `DeploymentMetricsRead` | 6 | Read owned deployment usage metrics | `DeploymentRead` |

Update/delete definitions cover application use cases; they do not add HTTP endpoints. The catalog does not grant access to other users' resources, and Super does not bypass ownership, subscription, or quota checks.

To store grants on a role, OR the masks computed as `1n << BigInt(permission.offset)`. Do not persist catalog definitions as separate permission rows. The SQL Server signed bigint storage supports offsets 0–62. Never reuse or renumber an assigned offset.

## Usage

Import `RequirePermissions` from `@kumo/presentation` and permission definitions from `@kumo/domain`. Place the decorator above an existing handler or controller:

```typescript
@RequirePermissions(Permission.DeploymentRead)
```

Pass multiple definitions to require all of them: `@RequirePermissions(firstPermission, secondPermission)`. A controller-level decorator applies to all its methods; method requirements add to the controller's list.

Prerequisites are metadata, so explicitly list both definitions when protecting an action that requires both: `@RequirePermissions(Permission.DeploymentRead, Permission.DeploymentMetricsRead)`. Granting a mutation bit does not implicitly grant read access.

The decorator installs its guard automatically. `PermissionsModule` is registered globally by the API root module; standalone Nest modules using the decorator must import that module or supply its guard's dependencies in tests.

For each permission check, the guard verifies the session user is active and not suspended, then queries active roles linked to that user. The application use case ORs the role bitsets and checks `(granted & required) === required`. The Super bit grants all valid requested permissions. Missing grants return HTTP 403; repository failures propagate rather than granting access. An empty permission list still requires an eligible authenticated user.

The API enforces these policies before use cases, idempotency replay, and response caching:

| Route | Required permissions |
| --- | --- |
| `POST /deployments` | `DeploymentCreate` |
| `GET /deployments` | `DeploymentRead` |
| `GET /deployments/:id` | `DeploymentRead` |
| `GET /deployment/build/:id` | `BuildRead` |
| `GET /deployments/:id/metrics` | `DeploymentRead`, `DeploymentMetricsRead` |

Permission checks do not replace resource ownership, Stripe subscription, or quota checks. Authentication and current-profile routes retain their session policies; pipeline manifest/source routes retain their per-build bearer-token authorization. Update/delete permissions are reserved for the application use cases until their HTTP endpoints are introduced. Internal workers do not require user sessions or permission decorators.

Users without assigned active roles granting the required bits receive HTTP 403. Role assignment and provisioning are not automatic. Revoking grants blocks subsequent requests, including cached reads and accepted-request retries.

The role activity migration defaults existing roles to active. Apply the new database migration before serving permission-protected routes.
