# Permission enforcement

Import `RequirePermissions` from `@kumo/presentation` and permission definitions from `@kumo/domain`. Place the decorator above an existing handler or controller:

```typescript
@RequirePermissions(Permission.DeploymentRead)
```

Pass multiple definitions to require all of them: `@RequirePermissions(firstPermission, secondPermission)`. A controller-level decorator applies to all its methods; method requirements add to the controller's list.

The decorator installs its guard automatically. `PermissionsModule` is registered globally by the API root module; standalone Nest modules using the decorator must import that module or supply its guard's dependencies in tests.

For each permission check, the guard verifies the session user is active and not suspended, then queries active roles linked to that user. The application use case ORs the role bitsets and checks `(granted & required) === required`. The Super bit grants all valid requested permissions. Missing grants return HTTP 403; repository failures propagate rather than granting access. An empty permission list still requires an eligible authenticated user.

Apply decorators to routes as their access policy is established. Permission checks do not replace resource ownership checks or enforce the catalog's `requires` metadata. Existing routes are unaffected until decorated.

The role activity migration defaults existing roles to active. Apply the new database migration before serving permission-protected routes.
