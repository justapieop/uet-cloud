# Azure runtime IAM

`infra/azure/iam.bicep` manages IAM for existing Kumo resources. It does not deploy
applications, databases, networking, registry credentials, GitHub Actions, or Azure
DevOps. `iam.kumo.json` identifies the current subscription and resource names;
it contains no credentials. Change that file for a different environment.

## Desired grants

| Principal | Grant | Scope |
| --- | --- | --- |
| API system identity | Custom Kumo Runtime Operations | Subscription |
| API system identity | Custom Kumo Shared Environment Access | Configured existing ACA environment |
| API system identity | Reader | ACR metadata only |
| API system identity | App Configuration Data Reader | Configuration store |
| API system identity | Key Vault Secrets User and Crypto User | Vault |
| API system identity | Managed Identity Operator | Existing `acr-id` identity |
| `acr-id` | Container Registry Repository Reader | ABAC-enabled registry |

Applied to the current Kumo subscription on 2026-11-07. The API's ten direct
assignments became seven, and the pull identity's six became one: eleven obsolete
assignments were removed after three replacement grants were created. Azure
deployment and assignment-presence checks passed; authenticated workload and
volume operations were not exercised as part of this IAM change.

The runtime role replaces subscription Contributor, Container Apps Contributor,
Managed Environments Contributor, Network Contributor, Reader, and Resource Policy
Contributor. It allows app CRUD/start/stop, user resource-group creation/update,
Azure Files account/share management, metrics reads, environment reads, and region
and policy discovery. It excludes role-assignment writes, policy changes, network
changes, environment provisioning, registry administration, and SQL administration.
The environment role permits joining and storage-link CRUD, without granting
environment configuration writes. Built-in Key Vault Crypto User is retained for
compatibility with the SDK's key retrieval/signing; it is broader than signing only.

The pull identity retains only Repository Reader. The script removes its obsolete
AcrPull, ARM Reader, Repository Writer, Data Importer/Data Reader, and registry
configuration administrator assignments on the configured registry. AcrPull is not
honored by an ABAC-enabled registry. Repository Reader is unconditional across this
registry, matching the current shared image namespace.

## Preview and apply

Requirements: PowerShell 7, Azure CLI with Container Apps support and Bicep installed,
and an operator permitted to create custom roles and assignments at subscription
scope. The operator also needs App Configuration data access for the legacy-mode
preflight check. Run `az login`, select the subscription, and install Bicep with
`az bicep install` if necessary.

From the repository root:

```powershell
# Read-only Azure preview; writes only local metadata and a backup.
pwsh -NoProfile -File infra/azure/Set-KumoIam.ps1

# Create replacement grants, verify their presence, then remove audited old grants.
pwsh -NoProfile -File infra/azure/Set-KumoIam.ps1 -Apply
```

The script validates private ABAC registry mode and RBAC Key Vault mode, refuses
enabled legacy provisioning, and discovers current principal IDs and existing
assignment names. This avoids `RoleAssignmentExists` conflicts when adopting
portal-created grants. It refuses to replace an adopted conditional assignment
with an unconditional one. Unknown grants, other identities, and other scopes
are preserved. It does not disable registry admin credentials because existing
platform image pulls still use them.

Backups and generated ARM/parameter files are ignored under `infra/azure/.local`.
A failed replacement check retains old grants. A failure during cleanup can leave
some old grants removed; rerunning converges, or restore from the snapshot below.
Assignment presence verifies ARM state, not data-plane propagation. Azure caches
permissions, so allow propagation and verify operations before relying on a release.

## Boundaries and remaining work

- **Subscription scope is still broad across resource names.** The API creates new
  user groups dynamically. Azure RBAC action lists cannot enforce `user-rg-*`
  prefix ownership or exclude the platform group from these grants. App ownership
  guards remain required. A stricter boundary needs a separate privileged group
  provisioner that grants API access to each user group, or a dedicated workload
  subscription. Do not describe this template as Azure-enforced tenant isolation.
- **Shared mode only.** Enabling `LegacyPerUserProvisioning` later requires a
  separate reviewed grant for legacy environment/network creation. Existing legacy
  apps require explicit join/storage-link grants on their own environments before
  this cleanup. The current inventory contains no legacy/customer apps.
- **Volumes:** account/share management and shared storage-link registration are
  covered. Azure Files mounting additionally needs SMB OAuth configuration and the
  environment identity's SMB data role on each workload storage account. This
  deployment does not invent subscription-wide SMB data access or repair that
  separate storage provisioning gap. See `azure-storage-rbac.md`; its historical
  fixed-region and broad-Contributor examples are not the IAM source of truth.
- **SQL:** contained database users and grants are SQL data-plane configuration.
  Existing database grants are preserved and have not been verified by this template.
- **Platform image pulls:** existing registry passwords remain; migrating the
  platform apps to identity-based pulls is a separate app configuration change.
- **Verification:** test authenticated API/configuration startup, signing, region
  discovery, app creation/redeploy/start/stop/delete, and volume operations where
  configured. GitHub Actions and Azure DevOps IAM remain outside this work.

## Restore removed assignments

Use the exact backup path printed by the apply command. Restore only entries in
`removals`, preserving their original GUIDs; this also supports partial cleanup.
Run as the same authorized operator and subscription:

```powershell
$backup = Get-Content -LiteralPath '<printed-backup-path>' -Raw | ConvertFrom-Json
$account = az account show --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $account.id -ne $backup.subscriptionId) { throw 'Wrong subscription' }
$current = @(az role assignment list --all --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read role assignments' }
foreach ($assignment in $backup.removals) {
    if ($assignment.id -in $current.id) { continue }
    az role assignment create --name $assignment.name `
        --assignee-object-id $assignment.principalId --assignee-principal-type ServicePrincipal `
        --role $assignment.roleDefinitionId --scope $assignment.scope --output none
    if ($LASTEXITCODE -ne 0) { throw "Restore failed: $($assignment.id)" }
}
```

New narrow grants can remain during rollback. Restoring the old broader grants
restores their former access; keep the backup until runtime verification succeeds.
