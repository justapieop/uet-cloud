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
| `PlanManage` | 7 | Administer local plans | None |
| `SubscriptionManage` | 8 | Inspect users' subscriptions and schedule/undo cancellation | None |
| `RoleManage` | 9 | Inspect and manage roles, and manage role assignments across users | None |

Deployment update/delete definitions cover application use cases; they do not add HTTP endpoints. PlanManage and SubscriptionManage explicitly grant cross-user administrative billing access. RoleManage grants cross-user role administration and permission-catalog access. Super does not bypass ownership, subscription, or quota checks on ordinary deployment APIs. See [admin billing APIs](admin-billing.md).

To store grants on a role, OR the masks computed as `1n << BigInt(permission.offset)`. Do not persist catalog definitions as separate permission rows. The SQL Server signed bigint storage supports offsets 0–62. Never reuse or renumber an assigned offset.

## Usage

Import `RequirePermissions` from `@kumo/presentation` and permission definitions from `@kumo/domain`. Place the decorator above an existing handler or controller:

```typescript
@RequirePermissions(Permission.DeploymentRead)
```

Pass multiple definitions to require all of them: `@RequirePermissions(firstPermission, secondPermission)`. A controller-level decorator applies to all its methods; method requirements add to the controller's list.

Prerequisites are metadata, so explicitly list both definitions when protecting an action that requires both: `@RequirePermissions(Permission.DeploymentRead, Permission.DeploymentMetricsRead)`. Granting a mutation bit does not implicitly grant read access.

The decorator installs its guard automatically. `PermissionsModule` is registered globally by the API root module; standalone Nest modules using the decorator must import that module or supply its guard's dependencies in tests.

Session deserialization reloads the current user and active assigned roles in one joined SQL read per request. It attaches a non-enumerable request-local permission mask; the guard verifies user eligibility and checks that mask. If no deserialized mask is present, `CheckPermissionsCase` queries active roles directly. Both paths OR role bits and check `(granted & required) === required`. Super grants all valid requested permissions. Grants are not cached across requests or persisted in session data. Missing grants return HTTP 403; database failures fail closed. An empty list still requires an eligible authenticated user.

The API enforces these policies before use cases, idempotency replay, and response caching:

| Route | Required permissions |
| --- | --- |
| `POST /deployments` | `DeploymentCreate` |
| `POST /deployments/:id/start` | `DeploymentUpdate` |
| `POST /deployments/:id/stop` | `DeploymentUpdate` |
| `GET /deployments` | `DeploymentRead` |
| `GET /deployments/:id` | `DeploymentRead` |
| `GET /deployment/build/:id` | `BuildRead` |
| `GET /deployments/:id/metrics` | `DeploymentRead`, `DeploymentMetricsRead` |
| `GET /roles` | `RoleManage` |
| `POST /roles` | `RoleManage` |
| `PUT /roles/:id` | `RoleManage` |
| `DELETE /roles/:id` | `RoleManage` |
| `GET /user/:userId/roles` | `RoleManage` |
| `PUT /user/:userId/roles` | `RoleManage` |

Permission checks do not replace resource ownership, Stripe subscription, or quota checks. Authentication and current-profile routes retain their session policies; pipeline manifest/source routes retain their per-build bearer-token authorization. Start/stop require DeploymentUpdate; rename and delete use cases still have no HTTP endpoints. Internal workers do not require user sessions or permission decorators.

`GET /roles` returns every role, including inactive roles, together with the static permission catalog. Role responses list exact stored permission keys, so a role with only the Super bit is returned as `["Super"]` rather than being expanded into every catalog entry. Permission metadata is informational; it does not grant prerequisites automatically.

Role writes accept exact permission keys from the catalog. `POST /roles` creates a role, `PUT /roles/:id` replaces its name, activity, and known grants, and `DELETE /roles/:id` deactivates it without deleting existing assignments. Inactive roles grant no permissions and cannot be assigned. Unknown permission bits already stored on a role are preserved when the role is replaced.

The role-management endpoints enforce additional guardrails beyond the route permission: an actor without Super cannot grant or remove permission bits they do not hold themselves, and an actor cannot update, deactivate, or assign away their own resulting `RoleManage` access. Assignment requests replace a user's complete role set, so an empty list removes every assignment.

`POST /plans/:id/subscriptions` is self-service billing for the current user. It requires an active, unsuspended authenticated user and a linked Stripe customer, rather than deployment role grants. It cannot subscribe another user or assign permissions.

`GET /plans/me` requires an active, unsuspended authenticated user and returns only that user's matching active plans. It needs no deployment permission grant. `GET /plans` remains a public catalog.

Users without assigned active roles granting the required bits receive HTTP 403. New users created by the OAuth signup flow receive the self-seeding `default` role. Existing users are not automatically assigned or reassigned roles. Revoking grants blocks subsequent requests, including cached reads and accepted-request retries.

The role activity migration defaults existing roles to active. Apply the new database migration before serving permission-protected routes.

## Default signup role

When `CreateUserCase` creates a new user, it ensures role ID `default` exists and assigns it in the same database transaction. A missing role is created with name `Default`, active status, and explicit DeploymentRead, BuildRead, DeploymentMetricsRead, DeploymentCreate, DeploymentUpdate, and DeploymentDelete grants. It receives no administrative grants or Super. Newly added permission catalog entries are not automatically included.

An existing default role retains its name, grants, and activity. If inactive, new-user registration fails without creating a user or contacting Stripe. Administrators can edit or deactivate it through the existing role-management APIs. Subsequent logins preserve existing assignments, including deliberately removed roles. Offline administrator creation and existing users are not backfilled.

Signup also self-seeds role ID `super`, name `Super`, active by default, storing only the Super bit. It is never automatically assigned. An existing Super role retains its name, permission bits, and activity; a disabled Super role does not block ordinary signup. It is separate from the existing offline `admin` role and does not change administrator bootstrap assignments. Both self-seeding checks occur only for newly created users.

User creation, optional role creation, and assignment commit or roll back together. A transaction-only role lookup takes SQL Server update/range locks on the role ID, including when missing, to serialize self-seeding across concurrent signups (lock `default` before `super`) and preserve concurrent administrative edits. Stripe Customer linking runs after commit; a Stripe failure does not undo the committed user/role assignment, and the next login retries linking without reassigning roles. Subscription, quota, and ownership checks still apply.
